#!/usr/bin/env python3
"""
Build a per-pack rivers.geojson from real DEM flow tracing.

Usage:
    python3 scripts/build_pack_rivers.py <pack_id>
    python3 scripts/build_pack_rivers.py alps

For every lake in packs/<pack_id>/lakes.json, this script:
  1. Computes a tight bbox around the lake + all downstream villages,
     inflated by MARGIN_M meters on each axis (anisotropic).
  2. Picks a zoom level sized to the bbox so the raster stays manageable
     for long paths (z12 → ~30 m cells for small packs, down to z10 →
     ~120 m cells for central_asia-scale 200 km paths).
  3. Fetches Mapzen Terrarium DEM tiles in parallel.
  4. Pit-fills the raster with Priority-Flood + Epsilon so glacial
     lake depressions don't trap the walk at the source.
  5. Computes D8 flow direction (vectorized numpy).
  6. Tries the primary seed cell, walks downhill. If some villages
     don't get matched, retries from alternate seeds in a ring around
     the lake point and keeps the walk that minimizes the worst-case
     snap distance across all villages.
  7. Projects each village onto its closest walk segment to get a
     clean terminus (no "spur-back" artifact from appending the raw
     village coordinate).
  8. Simplifies with Ramer-Douglas-Peucker at 30 m tolerance, smooths
     with Catmull-Rom (5 samples/segment).
  9. Emits one GeoJSON LineString feature per (lake, village) pair.
 10. Villages that cannot be matched within PROXIMITY_M_FALLBACK are
     NOT emitted (no cheap straight-line fallback) — instead the
     script exits with code 2 and lists them so the data can be
     manually fixed.

Output: packs/<pack_id>/rivers.geojson plus a `spatial.rivers` entry
in packs/<pack_id>/manifest.json.

Dependencies (NOT auto-installed):
    pip install requests pillow numpy
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from lib.flow_tracing import (  # noqa: E402
    DemMosaic,
    M_PER_DEG_LAT,
    build_dem_mosaic,
    catmull_rom_smooth,
    compute_d8,
    find_seed_cell,
    haversine_m,
    priority_flood_fill,
    rdp_simplify,
    walk_downhill,
)


# --- Tunable parameters --------------------------------------------------

# Margin around each lake's bbox. Applied in meters then converted to
# degrees per-axis so we get a true 15 km buffer in both directions
# regardless of latitude — a global degree margin under-buffers the
# east-west axis at mid latitudes due to the cosine(lat) shrinkage.
MARGIN_M = 15_000.0

# Dynamic zoom: pick the zoom level based on the bbox diagonal so the
# raster stays bounded for very long paths. z12 ≈ 38 m/equator, 26 m at
# 46°N (Alps); z11 ≈ 76 m; z10 ≈ 152 m. SRTM native resolution is 30 m.
# We bias toward z12 wherever memory allows — at z11, village snap
# distances bloat to ~1 km because the walk quantizes to 76 m cells,
# causing villages to be missed at the 1000 m fallback threshold.
def _zoom_for_bbox(diag_km: float) -> int:
    if diag_km < 100:
        return 12
    if diag_km < 200:
        return 11
    return 10


# Match thresholds. Primary is the "success" line; fallback is the max
# distance we'll accept before giving up on a village entirely. There
# is no straight-line fallback past this — the village is omitted from
# the output and listed for manual audit.
PROXIMITY_M_PRIMARY = 500.0
PROXIMITY_M_FALLBACK = 1000.0

# RDP tolerance in meters. At z10-z12 the raw walk has points every
# 30-120 m, so 30 m preserves meanders but drops the diagonal-staircase
# micro-zigzag of the raw trace.
RDP_TOLERANCE_M = 30.0

# Catmull-Rom samples per RDP segment. 5 gives ~5× point multiplication
# which is enough to erase the staircase after smoothing without making
# the GeoJSON files huge.
CATMULL_SAMPLES = 5

# Ring of seed offsets to try if the primary walk doesn't match all
# villages. Cells relative to the user-provided lake point. Tried in
# order — the first walk that matches everything wins.
_SEED_RINGS_CELLS = [0, 3, 6, 10, 15]

# Source tag values (written into each GeoJSON feature's properties).
SOURCE_DEM_D8 = "dem_d8_flow_tracing"

REPO_ROOT = SCRIPT_DIR.parent
CACHE_DIR = REPO_ROOT / ".cache" / "terrarium"


# --- Geometry helpers ----------------------------------------------------


def _project_onto_segment(
    a: tuple[float, float],
    b: tuple[float, float],
    p: tuple[float, float],
) -> tuple[tuple[float, float], float, float]:
    """
    Project point p onto segment a-b. Returns (projected_latlon, t, dist_m)
    where t is in [0, 1] along the segment and dist_m is the perpendicular
    distance in meters. Uses a local flat projection valid for short
    segments.
    """
    lat_a, lon_a = a
    lat_b, lon_b = b
    lat_p, lon_p = p
    mean_lat_rad = math.radians((lat_a + lat_b) / 2)
    m_per_deg_lon = M_PER_DEG_LAT * math.cos(mean_lat_rad)
    dx = (lon_b - lon_a) * m_per_deg_lon
    dy = (lat_b - lat_a) * M_PER_DEG_LAT
    px = (lon_p - lon_a) * m_per_deg_lon
    py = (lat_p - lat_a) * M_PER_DEG_LAT
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq < 1e-9:
        return a, 0.0, math.hypot(px, py)
    t = max(0.0, min(1.0, (px * dx + py * dy) / seg_len_sq))
    proj_lat = lat_a + t * (lat_b - lat_a)
    proj_lon = lon_a + t * (lon_b - lon_a)
    perp_x = px - t * dx
    perp_y = py - t * dy
    return (proj_lat, proj_lon), t, math.hypot(perp_x, perp_y)


def _closest_point_on_polyline(
    walk: list[tuple[float, float]],
    village: tuple[float, float],
) -> tuple[int, tuple[float, float], float]:
    """
    Return (segment_idx, projected_point, distance_m) for the closest
    approach of `village` to the polyline. Empty walks return sentinel.
    """
    if len(walk) < 2:
        return -1, (0.0, 0.0), float("inf")
    best = (-1, (0.0, 0.0), float("inf"))
    for i in range(len(walk) - 1):
        proj, _t, d = _project_onto_segment(walk[i], walk[i + 1], village)
        if d < best[2]:
            best = (i, proj, d)
    return best


def _polyline_length_m(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for i in range(1, len(points)):
        total += haversine_m(
            points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]
        )
    return total


def _lake_bbox(lake: dict) -> tuple[float, float, float, float]:
    """Return (min_lat, min_lon, max_lat, max_lon) inflated by MARGIN_M in meters."""
    lats = [lake["lat"]]
    lons = [lake["lon"]]
    for v in lake.get("villages", []):
        if v.get("lat") is not None and v.get("lon") is not None:
            lats.append(v["lat"])
            lons.append(v["lon"])
    mean_lat = (min(lats) + max(lats)) / 2.0
    d_lat = MARGIN_M / M_PER_DEG_LAT
    d_lon = MARGIN_M / (M_PER_DEG_LAT * math.cos(math.radians(mean_lat)))
    return (
        min(lats) - d_lat,
        min(lons) - d_lon,
        max(lats) + d_lat,
        max(lons) + d_lon,
    )


def _bbox_diag_km(min_lat: float, min_lon: float, max_lat: float, max_lon: float) -> float:
    return haversine_m(min_lat, min_lon, max_lat, max_lon) / 1000.0


# --- Walk selection (multi-seed retry) -----------------------------------


def _candidate_seeds(
    mosaic: DemMosaic,
    d8,
    lake_row: int,
    lake_col: int,
) -> list[tuple[int, int]]:
    """
    Generate candidate seed cells: the primary find_seed_cell result,
    plus 8 cells on rings at several radii around the lake point. Keeps
    only cells with a valid D8 direction (after epsilon fill, this is
    almost always the case).
    """
    seeds: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()

    def _add(r: int, c: int) -> None:
        if (r, c) in seen:
            return
        if r < 0 or r >= mosaic.height or c < 0 or c >= mosaic.width:
            return
        if d8[r, c] < 0:
            return
        seen.add((r, c))
        seeds.append((r, c))

    primary = find_seed_cell(d8, lake_row, lake_col)
    _add(*primary)

    for radius in _SEED_RINGS_CELLS[1:]:
        for dr, dc in (
            (-radius, 0),
            (-radius, radius),
            (0, radius),
            (radius, radius),
            (radius, 0),
            (radius, -radius),
            (0, -radius),
            (-radius, -radius),
        ):
            _add(lake_row + dr, lake_col + dc)
    return seeds


def _pick_best_walk(
    mosaic: DemMosaic,
    d8,
    lake: dict,
    lake_row: int,
    lake_col: int,
    max_steps: int,
    progress_prefix: str,
) -> tuple[list[tuple[float, float]], dict[str, tuple[int, tuple[float, float], float]]]:
    """
    Try several candidate seeds. For each, walk downhill and score by
    the worst-case closest-approach distance across all villages. Return
    the best walk's latlon polyline and its per-village match info.

    Scoring uses minimax: the walk that minimizes the largest unmatched
    distance wins. This tends to pick the walk that catches the problem
    villages first, before optimizing for already-easy ones.
    """
    seeds = _candidate_seeds(mosaic, d8, lake_row, lake_col)
    villages_with_coords = [
        v for v in lake.get("villages", [])
        if v.get("lat") is not None and v.get("lon") is not None
    ]

    best_worst = float("inf")
    best_walk_latlon: list[tuple[float, float]] = []
    best_matches: dict[str, tuple[int, tuple[float, float], float]] = {}

    for idx, (sr, sc) in enumerate(seeds):
        walk = walk_downhill(d8, sr, sc, max_steps=max_steps)
        walk_latlon = [mosaic.cell_to_latlon(r, c) for (r, c) in walk]
        if len(walk_latlon) < 2:
            continue
        matches: dict[str, tuple[int, tuple[float, float], float]] = {}
        worst = 0.0
        for v in villages_with_coords:
            m = _closest_point_on_polyline(walk_latlon, (v["lat"], v["lon"]))
            matches[v["name"]] = m
            worst = max(worst, m[2])
        if worst < best_worst:
            best_worst = worst
            best_walk_latlon = walk_latlon
            best_matches = matches
            if worst <= PROXIMITY_M_PRIMARY:
                # Already great — don't keep trying alternate seeds.
                print(
                    f"{progress_prefix}seed {idx} matches all villages under "
                    f"{PROXIMITY_M_PRIMARY:.0f} m — stopping retry"
                )
                break
    return best_walk_latlon, best_matches


# --- Feature construction ------------------------------------------------


def _build_feature(
    lake: dict,
    village: dict,
    walk_latlon: list[tuple[float, float]],
    match: tuple[int, tuple[float, float], float],
) -> dict | None:
    """
    Build one GeoJSON LineString feature for this lake→village pair.
    Returns None when the match distance exceeds PROXIMITY_M_FALLBACK
    so the caller can record and skip the village.
    """
    seg_idx, proj, match_dist = match
    if seg_idx < 0 or match_dist > PROXIMITY_M_FALLBACK:
        return None

    prefix = list(walk_latlon[: seg_idx + 1])
    # Replace the final cell with the projection point so the polyline
    # ends exactly at the closest approach — not the raw cell center —
    # and avoids "spur back" when the projection is on the far side of
    # the cell center from the village.
    raw_path = prefix + [proj]

    simplified = rdp_simplify(raw_path, tolerance_m=RDP_TOLERANCE_M)
    smoothed = catmull_rom_smooth(simplified, samples_per_segment=CATMULL_SAMPLES)
    length_m = _polyline_length_m(smoothed)

    # GeoJSON uses [lon, lat]; round to 6 decimal places (~10 cm).
    coords = [[round(float(lon), 6), round(float(lat), 6)] for (lat, lon) in smoothed]

    return {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": coords,
        },
        "properties": {
            "lake_id": lake["id"],
            "village_name": village["name"],
            "path_length_m": round(length_m, 1),
            "point_count": len(coords),
            "source": SOURCE_DEM_D8,
            "match_snap_m": round(match_dist, 1),
        },
    }


# --- Main per-lake pipeline ----------------------------------------------


def _build_lake(
    lake: dict,
    progress_prefix: str = "",
) -> tuple[list[dict], list[tuple[str, str, float]]]:
    """
    Build all features for one lake. Returns (features, unmatched) where
    unmatched is a list of (lake_id, village_name, snap_m) tuples for
    villages we had to drop.
    """
    min_lat, min_lon, max_lat, max_lon = _lake_bbox(lake)
    diag_km = _bbox_diag_km(min_lat, min_lon, max_lat, max_lon)
    zoom = _zoom_for_bbox(diag_km)
    print(
        f"{progress_prefix}bbox diag={diag_km:.0f} km → zoom {zoom} "
        f"({min_lat:.3f},{min_lon:.3f}) → ({max_lat:.3f},{max_lon:.3f})"
    )

    t0 = time.monotonic()
    mosaic = build_dem_mosaic(
        min_lat=min_lat,
        min_lon=min_lon,
        max_lat=max_lat,
        max_lon=max_lon,
        zoom=zoom,
        cache_dir=CACHE_DIR,
        progress_prefix=progress_prefix,
    )
    print(
        f"{progress_prefix}DEM: {mosaic.height}x{mosaic.width} cells "
        f"({time.monotonic() - t0:.1f} s)"
    )

    t0 = time.monotonic()
    filled = priority_flood_fill(mosaic.elev)
    print(f"{progress_prefix}pit fill ({time.monotonic() - t0:.1f} s)")

    t0 = time.monotonic()
    d8 = compute_d8(filled)
    valid_interior = int((d8 >= 0).sum())
    total_interior = max(0, (mosaic.height - 2)) * max(0, (mosaic.width - 2))
    print(
        f"{progress_prefix}D8 ({time.monotonic() - t0:.1f} s) "
        f"valid={valid_interior}/{total_interior}"
    )

    try:
        lake_row, lake_col = mosaic.latlon_to_cell(lake["lat"], lake["lon"])
    except ValueError as e:
        print(f"{progress_prefix}ERROR: {e}", file=sys.stderr)
        return [], [(lake["id"], "<lake seed>", float("inf"))]

    # Adaptive step cap: generous enough for a full ribbon walk through
    # the raster. 4× the longer raster axis is more than enough for any
    # realistic meander and short-circuits cleanly if the walk gets stuck.
    max_steps = max(8000, 4 * max(mosaic.height, mosaic.width))

    walk_latlon, matches = _pick_best_walk(
        mosaic=mosaic,
        d8=d8,
        lake=lake,
        lake_row=lake_row,
        lake_col=lake_col,
        max_steps=max_steps,
        progress_prefix=progress_prefix,
    )

    if not walk_latlon:
        print(
            f"{progress_prefix}ERROR: no valid walk for {lake['id']}",
            file=sys.stderr,
        )
        return [], [
            (lake["id"], v["name"], float("inf"))
            for v in lake.get("villages", [])
            if v.get("lat") is not None
        ]

    # Walk-terminated-at-edge warning.
    if len(walk_latlon) >= max_steps - 1:
        print(
            f"{progress_prefix}WARN: walk hit max_steps={max_steps}, "
            f"likely truncated",
            file=sys.stderr,
        )

    features: list[dict] = []
    unmatched: list[tuple[str, str, float]] = []
    for village in lake.get("villages", []):
        if village.get("lat") is None or village.get("lon") is None:
            print(
                f"{progress_prefix}  SKIP {village['name']}: no lat/lon",
                file=sys.stderr,
            )
            continue
        match = matches.get(village["name"])
        if match is None:
            unmatched.append((lake["id"], village["name"], float("inf")))
            continue
        feat = _build_feature(lake, village, walk_latlon, match)
        if feat is None:
            unmatched.append((lake["id"], village["name"], match[2]))
            print(
                f"{progress_prefix}  UNMATCHED {village['name']}: "
                f"snap={match[2]:.0f}m (>{PROXIMITY_M_FALLBACK:.0f}m)",
                file=sys.stderr,
            )
            continue
        props = feat["properties"]
        print(
            f"{progress_prefix}  {props['village_name']:>20s}: "
            f"snap={props['match_snap_m']:>6.0f}m  "
            f"len={props['path_length_m'] / 1000:>5.1f}km  "
            f"pts={props['point_count']:>4d}"
        )
        features.append(feat)
    return features, unmatched


# --- Whole-pack pipeline -------------------------------------------------


def build_pack(pack_id: str) -> None:
    pack_dir = REPO_ROOT / "packs" / pack_id
    lakes_path = pack_dir / "lakes.json"
    manifest_path = pack_dir / "manifest.json"
    if not lakes_path.is_file():
        print(f"ERROR: {lakes_path} not found", file=sys.stderr)
        sys.exit(1)
    if not manifest_path.is_file():
        print(f"ERROR: {manifest_path} not found", file=sys.stderr)
        sys.exit(1)

    data = json.loads(lakes_path.read_text(encoding="utf-8"))
    lakes = data.get("lakes", [])
    if not lakes:
        print(f"ERROR: pack '{pack_id}' has no lakes in lakes.json", file=sys.stderr)
        sys.exit(1)

    print(f"Building river paths for pack '{pack_id}' ({len(lakes)} lakes)")
    print(f"Cache dir: {CACHE_DIR}")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    all_features: list[dict] = []
    errors: list[tuple[str, str]] = []
    all_unmatched: list[tuple[str, str, float]] = []
    for i, lake in enumerate(lakes, 1):
        print(f"\n[{i}/{len(lakes)}] {lake['name']} ({lake['id']})")
        try:
            features, unmatched = _build_lake(lake, progress_prefix="  ")
            all_features.extend(features)
            all_unmatched.extend(unmatched)
        except Exception as e:
            print(f"  ERROR building {lake['id']}: {e}", file=sys.stderr)
            traceback.print_exc()
            errors.append((lake["id"], str(e)))

    # Serialize once, compute hash from the in-memory bytes (single disk write).
    geojson = {
        "type": "FeatureCollection",
        "features": all_features,
        "metadata": {
            "pack_id": pack_id,
            "feature_count": len(all_features),
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": SOURCE_DEM_D8,
            "rdp_tolerance_m": RDP_TOLERANCE_M,
            "catmull_samples_per_segment": CATMULL_SAMPLES,
            "proximity_m_primary": PROXIMITY_M_PRIMARY,
            "proximity_m_fallback": PROXIMITY_M_FALLBACK,
            "margin_m": MARGIN_M,
        },
    }
    geojson_bytes = (json.dumps(geojson, indent=2) + "\n").encode("utf-8")
    out_path = pack_dir / "rivers.geojson"
    out_path.write_bytes(geojson_bytes)
    size_bytes = len(geojson_bytes)
    sha256 = hashlib.sha256(geojson_bytes).hexdigest()
    print(
        f"\nWrote {out_path} ({size_bytes / 1024:.1f} KB, {len(all_features)} features)"
    )

    # Patch manifest.
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    spatial = manifest.setdefault("spatial", {})
    spatial["rivers"] = {
        "file": "rivers.geojson",
        "feature_count": len(all_features),
        "size_bytes": size_bytes,
        "sha256": sha256,
        "source": SOURCE_DEM_D8,
        "rdp_tolerance_m": RDP_TOLERANCE_M,
        "catmull_samples_per_segment": CATMULL_SAMPLES,
        "proximity_m_primary": PROXIMITY_M_PRIMARY,
        "proximity_m_fallback": PROXIMITY_M_FALLBACK,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {manifest_path}")

    # Audit summary.
    if all_unmatched:
        print(
            f"\nWARNING: {len(all_unmatched)} village(s) could not be matched "
            f"within {PROXIMITY_M_FALLBACK:.0f} m — features omitted:",
            file=sys.stderr,
        )
        for lake_id, village_name, snap in all_unmatched:
            snap_str = f"{snap:.0f}m" if snap != float("inf") else "no walk"
            print(f"  {lake_id} -> {village_name} ({snap_str})", file=sys.stderr)

    if errors:
        print(f"\n{len(errors)} lake(s) failed to build:", file=sys.stderr)
        for lake_id, msg in errors:
            print(f"  {lake_id}: {msg}", file=sys.stderr)
        sys.exit(2)

    if all_unmatched:
        # Non-zero exit so CI / manual ops know something needs attention,
        # but the rivers.geojson is still written with whatever we got.
        sys.exit(2)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: build_pack_rivers.py <pack_id>", file=sys.stderr)
        return 1
    build_pack(argv[1])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
