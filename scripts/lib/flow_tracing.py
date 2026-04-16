"""
Pure-math utilities for tracing real river paths from a raster DEM.

Used by scripts/build_pack_rivers.py to turn Mapzen Terrarium elevation
tiles into per-village flow polylines. Keeps the build script itself
thin and makes the individual pieces (pit fill, D8, RDP, Catmull-Rom)
unit-testable in isolation. See the self-test at the bottom.

Dependencies: numpy, Pillow, requests (same three the hillshade script
already uses — no new pip installs).

Everything here is pure Python / numpy. No GDAL, no rasterio, no GIS
runtime dependency. That's deliberate — the user wants the whole
pipeline to run locally with the same small set of deps the rest of
the project already has.
"""
from __future__ import annotations

import heapq
import math
import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import numpy as np
import requests
from PIL import Image, UnidentifiedImageError


EARTH_R_M = 6_371_008.8
M_PER_DEG_LAT = math.pi / 180.0 * EARTH_R_M  # 111195.08 m/degree
TILE_PX = 256
TERRARIUM_URL = (
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
)

# D8 neighbor offsets. Order matters — index is the D8 code we store in
# the flow-direction raster. 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW.
D8_DIRS: list[tuple[int, int]] = [
    (-1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, -1),
]
# sqrt(2) for diagonal neighbors, 1 for straight. Used as a slope
# normalizer so diagonal moves compete fairly with straight moves.
D8_INV_DIST: list[float] = [
    1.0, 1.0 / math.sqrt(2), 1.0, 1.0 / math.sqrt(2),
    1.0, 1.0 / math.sqrt(2), 1.0, 1.0 / math.sqrt(2),
]


# ── Geo math ──────────────────────────────────────────────────────────────


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points in meters."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_R_M * math.asin(math.sqrt(a))


def latlon_to_tile(lat: float, lon: float, z: int) -> tuple[int, int]:
    """Return the (x, y) tile indices covering (lat, lon) at zoom z."""
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def tile_nw_corner_latlon(x: int, y: int, z: int) -> tuple[float, float]:
    """Lat/lon of the NW corner of tile (x, y, z)."""
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


def global_pixel_to_latlon(px: float, py: float, z: int) -> tuple[float, float]:
    """
    Convert a web-mercator global pixel coordinate to (lat, lon).
    px, py are continuous (not just integers) so this works for sub-pixel
    positions after interpolation.
    """
    total = (2 ** z) * TILE_PX
    lon = px / total * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py / total))))
    return lat, lon


# ── Tile fetching + mosaic ────────────────────────────────────────────────


def fetch_tile(z: int, x: int, y: int, cache_dir: Path | None) -> Image.Image:
    """
    Download a Terrarium tile, with optional on-disk cache. Returns a PIL
    Image in RGB mode so the caller can immediately convert to numpy.
    """
    if cache_dir is not None:
        cache_path = cache_dir / f"{z}" / f"{x}" / f"{y}.png"
        if cache_path.is_file():
            return Image.open(cache_path).convert("RGB")

    url = TERRARIUM_URL.format(z=z, x=x, y=y)
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    buf = r.content

    if cache_dir is not None:
        cache_path = cache_dir / f"{z}" / f"{x}" / f"{y}.png"
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(buf)

    return Image.open(BytesIO(buf)).convert("RGB")


def decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    """
    Terrarium encoding: height = (R*256 + G + B/256) - 32768.
    rgb is a (H, W, 3) uint8 array; returns a (H, W) float32 elevation
    array in meters.
    """
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)
    return r * 256.0 + g + b / 256.0 - 32768.0


@dataclass
class DemMosaic:
    """
    A stitched DEM raster plus the web-mercator georef needed to map
    (row, col) cells back to (lat, lon).
    """
    elev: np.ndarray        # (H, W) float32 meters
    zoom: int
    tile_x_min: int         # global tile index of the NW-most tile
    tile_y_min: int
    # Cached width/height for convenience
    height: int
    width: int

    def cell_to_global_pixel(self, row: int, col: int) -> tuple[float, float]:
        """Pixel center in web-mercator global pixel coordinates."""
        px = self.tile_x_min * TILE_PX + col + 0.5
        py = self.tile_y_min * TILE_PX + row + 0.5
        return px, py

    def cell_to_latlon(self, row: int, col: int) -> tuple[float, float]:
        px, py = self.cell_to_global_pixel(row, col)
        return global_pixel_to_latlon(px, py, self.zoom)

    def latlon_to_cell(self, lat: float, lon: float) -> tuple[int, int]:
        """
        Convert lat/lon to (row, col). Raises ValueError if the point is
        outside the raster — callers that want clamping behavior should
        check bounds themselves first. Silent clamping previously masked
        bugs where lakes got routed to the corner of the DEM with no
        hint something was wrong.
        """
        n = 2 ** self.zoom
        total = n * TILE_PX
        px_global = (lon + 180.0) / 360.0 * total
        lat_rad = math.radians(lat)
        py_global = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * total
        col = int(round(px_global - self.tile_x_min * TILE_PX - 0.5))
        row = int(round(py_global - self.tile_y_min * TILE_PX - 0.5))
        if row < 0 or row >= self.height or col < 0 or col >= self.width:
            raise ValueError(
                f"point ({lat:.4f}, {lon:.4f}) is outside DEM mosaic bounds "
                f"(row={row}/{self.height}, col={col}/{self.width})"
            )
        return row, col


def build_dem_mosaic(
    min_lat: float,
    min_lon: float,
    max_lat: float,
    max_lon: float,
    zoom: int,
    cache_dir: Path | None,
    progress_prefix: str = "",
    max_workers: int = 8,
) -> DemMosaic:
    """
    Fetch all Terrarium tiles covering the bbox at the given zoom,
    stitch them into one elevation raster, and return a DemMosaic with
    georef metadata. Raises RuntimeError if ANY tile fails — a silent
    black gap would decode to a -32768 m crater and poison flow routing.

    Parallelizes fetches with a ThreadPoolExecutor (default 8 workers)
    so large bboxes (e.g. central_asia Sarez at 250 km) don't serialize
    on HTTP latency. Warm cache hits bypass the pool entirely.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    # Mercator y grows southward: the tile covering min_lat has the
    # LARGER y index. We swap to get (y0 = north top, y1 = south bottom).
    x0, y1 = latlon_to_tile(min_lat, min_lon, zoom)
    x1, y0 = latlon_to_tile(max_lat, max_lon, zoom)
    x_range = range(min(x0, x1), max(x0, x1) + 1)
    y_range = range(min(y0, y1), max(y0, y1) + 1)

    width = len(x_range) * TILE_PX
    height = len(y_range) * TILE_PX
    mosaic = Image.new("RGB", (width, height))
    tile_tasks: list[tuple[int, int, int, int]] = []  # (ix, iy, x, y)
    for iy, y in enumerate(y_range):
        for ix, x in enumerate(x_range):
            tile_tasks.append((ix, iy, x, y))
    total = len(tile_tasks)
    print(f"{progress_prefix}  fetching {total} tile(s) at z{zoom}")

    def _work(task: tuple[int, int, int, int]) -> tuple[int, int, int, int, Image.Image]:
        ix, iy, x, y = task
        return ix, iy, x, y, fetch_tile(zoom, x, y, cache_dir)

    fetched = 0
    failures: list[tuple[int, int, int, str]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_work, task): task for task in tile_tasks}
        for fut in as_completed(futures):
            task = futures[fut]
            try:
                ix, iy, x, y, tile = fut.result()
            except (requests.RequestException, OSError, UnidentifiedImageError) as e:
                _, _, x, y = task
                failures.append((zoom, x, y, str(e)))
                print(
                    f"{progress_prefix}  tile {zoom}/{x}/{y} failed: {e}",
                    file=sys.stderr,
                )
                continue
            mosaic.paste(tile, (ix * TILE_PX, iy * TILE_PX))
            fetched += 1
            if fetched == 1 or fetched == total or fetched % max(1, total // 5) == 0:
                print(f"{progress_prefix}  fetched {fetched}/{total}")

    if failures:
        raise RuntimeError(
            f"DEM mosaic incomplete: {len(failures)} tile(s) failed. "
            f"First failure: {failures[0]}. Retry the build — the disk cache "
            f"will keep the tiles that did succeed."
        )

    elev = decode_terrarium(np.array(mosaic))
    return DemMosaic(
        elev=elev,
        zoom=zoom,
        tile_x_min=min(x_range),
        tile_y_min=min(y_range),
        height=elev.shape[0],
        width=elev.shape[1],
    )


# ── Priority-Flood + Epsilon pit filling (Barnes 2014, Algorithm 3) ───────


# Smallest elevation nudge we add to each flat-fill step. We keep the
# filled raster in float64 throughout (float32 ULP at 9000 m is ~9e-3 m,
# larger than this epsilon and would erase the gradient on downcast).
# A 10k-cell plateau accumulates ~1 cm of drift — well under real
# topographic variation so routing is unaffected.
_FILL_EPSILON_M = 1e-3


def priority_flood_fill(elev: np.ndarray) -> np.ndarray:
    """
    Single-priority-queue variant of Barnes 2014 Algorithm 3 — fills
    pits AND imposes a tiny downhill gradient on flats so every interior
    cell has a strictly downhill neighbor afterwards.

    CRITICAL for GLOF simulation: glacial lakes ARE depressions. Without
    the epsilon increment, every cell inside the filled lake plateau
    would tie its neighbors in elevation, compute_d8 would return -1 for
    all of them, and walk_downhill would die on step 0 at the lake. With
    the epsilon increment the plateau gets a micro-gradient radiating
    inward from the spillway, so D8 deterministically routes any seed
    cell inside the lake back out through the spillway.

    Runs in float64 internally for precision over long plateau fills.
    Return is float64 — do not downcast between fill and compute_d8.
    """
    h, w = elev.shape
    filled = elev.astype(np.float64, copy=True)
    closed = np.zeros((h, w), dtype=bool)

    # Priority queue holds (elev, counter, row, col). Counter breaks ties
    # so we don't fall through to comparing raw numpy scalars.
    heap: list[tuple[float, int, int, int]] = []
    counter = 0

    for r in range(h):
        for c in (0, w - 1):
            heapq.heappush(heap, (float(filled[r, c]), counter, r, c))
            counter += 1
            closed[r, c] = True
    for c in range(1, w - 1):
        for r in (0, h - 1):
            heapq.heappush(heap, (float(filled[r, c]), counter, r, c))
            counter += 1
            closed[r, c] = True

    while heap:
        e, _, r, c = heapq.heappop(heap)
        for dr, dc in D8_DIRS:
            nr, nc = r + dr, c + dc
            if nr < 0 or nr >= h or nc < 0 or nc >= w:
                continue
            if closed[nr, nc]:
                continue
            ne = float(filled[nr, nc])
            # Force neighbor to at least e + EPSILON so its D8 direction
            # will point back toward `c` (its parent in the fill tree),
            # which is one step closer to the spillway.
            min_ne = e + _FILL_EPSILON_M
            if ne < min_ne:
                filled[nr, nc] = min_ne
                ne = min_ne
            closed[nr, nc] = True
            heapq.heappush(heap, (ne, counter, nr, nc))
            counter += 1

    return filled


# ── D8 flow direction ─────────────────────────────────────────────────────


def compute_d8(elev: np.ndarray) -> np.ndarray:
    """
    Return an (H, W) int8 array with the D8 code (0..7) for each interior
    cell, or -1 for cells that are local minima / flats (should be rare
    after epsilon pit filling) and for raster-edge cells.

    Vectorized over numpy — one pass per neighbor direction instead of
    the naive nested loop. ~50× faster on 1000×1000 rasters.
    """
    h, w = elev.shape
    out = np.full((h, w), -1, dtype=np.int8)
    if h < 3 or w < 3:
        return out

    interior = (slice(1, -1), slice(1, -1))
    e = elev[interior]
    best_slope = np.zeros_like(e)
    best_code = np.full(e.shape, -1, dtype=np.int8)

    for code, ((dr, dc), inv_d) in enumerate(zip(D8_DIRS, D8_INV_DIST)):
        ne = elev[1 + dr : h - 1 + dr, 1 + dc : w - 1 + dc]
        slope = (e - ne) * inv_d
        # Only consider strictly downhill moves that beat the current best.
        mask = (ne < e) & (slope > best_slope)
        best_slope = np.where(mask, slope, best_slope)
        best_code = np.where(mask, np.int8(code), best_code)

    out[interior] = best_code
    return out


# ── Outlet selection + downhill walk ──────────────────────────────────────


def find_seed_cell(
    d8: np.ndarray,
    lake_row: int,
    lake_col: int,
    search_radius: int = 5,
) -> tuple[int, int]:
    """
    Find a cell with a valid D8 direction at or near the user-provided
    lake point so walk_downhill has something to walk from. After the
    epsilon pit fill, every interior cell inside a filled lake has a
    valid D8 direction pointing back toward the spillway, so this
    function just has to handle the edge case where the user's seed
    coordinate happens to land on a raster border cell (where D8 is -1
    by construction).

    Returns the nearest cell (Chebyshev distance) with `d8 >= 0`, or
    the original cell if nothing in the search box has a valid direction
    (meaning pit filling failed somehow — caller should warn).
    """
    h, w = d8.shape
    if 0 <= lake_row < h and 0 <= lake_col < w and d8[lake_row, lake_col] >= 0:
        return lake_row, lake_col

    for radius in range(1, search_radius + 1):
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                if max(abs(dr), abs(dc)) != radius:
                    continue  # only scan the new ring, not the interior
                r = lake_row + dr
                c = lake_col + dc
                if r < 0 or r >= h or c < 0 or c >= w:
                    continue
                if d8[r, c] >= 0:
                    return r, c
    return lake_row, lake_col


def walk_downhill(
    d8: np.ndarray,
    start_row: int,
    start_col: int,
    max_steps: int,
) -> list[tuple[int, int]]:
    """
    Walk downhill from (start_row, start_col) following D8 flow direction.
    Stops when we hit a cell with no valid downhill neighbor, leave the
    raster, revisit a previously walked cell, or exceed max_steps.

    Cycle detection is belt-and-suspenders — after the epsilon pit fill
    every step strictly decreases elevation so cycles are provably
    impossible, but the visited check is cheap insurance against future
    regressions in compute_d8.
    """
    h, w = d8.shape
    r, c = start_row, start_col
    path = [(r, c)]
    visited: set[tuple[int, int]] = {(r, c)}
    for _ in range(max_steps):
        code = int(d8[r, c])
        if code < 0:
            break
        dr, dc = D8_DIRS[code]
        nr, nc = r + dr, c + dc
        if nr < 0 or nr >= h or nc < 0 or nc >= w:
            break
        if (nr, nc) in visited:
            break
        r, c = nr, nc
        visited.add((r, c))
        path.append((r, c))
    return path


# ── Polyline simplification (Ramer-Douglas-Peucker) ───────────────────────


def _perpendicular_distance_m(
    point: tuple[float, float],
    line_start: tuple[float, float],
    line_end: tuple[float, float],
) -> float:
    """
    Distance in meters from `point` to the line segment (line_start, line_end).
    Approximates the lat/lon points as a local flat plane — accurate enough
    for RDP tolerance comparisons at river-scale distances.
    """
    lat0, lon0 = line_start
    lat1, lon1 = line_end
    latp, lonp = point
    # Local flat projection: 1 degree lat = M_PER_DEG_LAT,
    # 1 degree lon = M_PER_DEG_LAT * cos(mean_lat).
    mean_lat_rad = math.radians((lat0 + lat1) / 2)
    m_per_deg_lon = M_PER_DEG_LAT * math.cos(mean_lat_rad)
    mx1 = (lon1 - lon0) * m_per_deg_lon
    my1 = (lat1 - lat0) * M_PER_DEG_LAT
    mxp = (lonp - lon0) * m_per_deg_lon
    myp = (latp - lat0) * M_PER_DEG_LAT

    dx = mx1
    dy = my1
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0:
        return math.hypot(mxp, myp)
    t = max(0.0, min(1.0, (mxp * dx + myp * dy) / seg_len_sq))
    proj_x = t * dx
    proj_y = t * dy
    return math.hypot(mxp - proj_x, myp - proj_y)


def rdp_simplify(
    points: list[tuple[float, float]],
    tolerance_m: float,
) -> list[tuple[float, float]]:
    """
    Ramer-Douglas-Peucker polyline simplification. Iterative (not
    recursive) so it doesn't blow the Python stack on long paths.
    Returns a new list.
    """
    if len(points) < 3:
        return list(points)

    keep = [False] * len(points)
    keep[0] = True
    keep[-1] = True
    stack: list[tuple[int, int]] = [(0, len(points) - 1)]

    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        max_d = 0.0
        max_i = -1
        a = points[lo]
        b = points[hi]
        for i in range(lo + 1, hi):
            d = _perpendicular_distance_m(points[i], a, b)
            if d > max_d:
                max_d = d
                max_i = i
        if max_d > tolerance_m and max_i >= 0:
            keep[max_i] = True
            stack.append((lo, max_i))
            stack.append((max_i, hi))

    return [points[i] for i in range(len(points)) if keep[i]]


# ── Catmull-Rom spline smoothing ──────────────────────────────────────────


def catmull_rom_smooth(
    points: list[tuple[float, float]],
    samples_per_segment: int = 6,
) -> list[tuple[float, float]]:
    """
    Interpolate a smooth curve through the input control points using a
    uniform Catmull-Rom spline. Passes exactly through each control
    point; samples the curve between them. First and last segments use
    reflected phantom endpoints so the curve doesn't fly off.
    """
    if len(points) < 2:
        return list(points)
    if len(points) == 2:
        # Linear interpolation between two points.
        out: list[tuple[float, float]] = []
        for s in range(samples_per_segment + 1):
            t = s / samples_per_segment
            out.append(
                (
                    points[0][0] * (1 - t) + points[1][0] * t,
                    points[0][1] * (1 - t) + points[1][1] * t,
                )
            )
        return out

    def phantom_before() -> tuple[float, float]:
        return (
            2 * points[0][0] - points[1][0],
            2 * points[0][1] - points[1][1],
        )

    def phantom_after() -> tuple[float, float]:
        return (
            2 * points[-1][0] - points[-2][0],
            2 * points[-1][1] - points[-2][1],
        )

    extended = [phantom_before()] + list(points) + [phantom_after()]

    out: list[tuple[float, float]] = []
    for i in range(1, len(extended) - 2):
        p0 = extended[i - 1]
        p1 = extended[i]
        p2 = extended[i + 1]
        p3 = extended[i + 2]
        # Skip s=0 on all segments except the first so we don't emit the
        # same seam point twice (segment i's s=S equals segment i+1's s=0).
        start_s = 0 if i == 1 else 1
        for s in range(start_s, samples_per_segment + 1):
            t = s / samples_per_segment
            t2 = t * t
            t3 = t2 * t
            # Catmull-Rom basis (tension = 0.5)
            x = 0.5 * (
                (2 * p1[0])
                + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                (2 * p1[1])
                + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            out.append((x, y))
    return out


# ── Self-test ─────────────────────────────────────────────────────────────


def _selftest() -> None:
    """
    Sanity checks that run on synthetic data, no network required.
    Run with: python3 scripts/lib/flow_tracing.py
    """
    print("running flow_tracing self-tests...")

    # 1. Haversine: 1 degree lat ≈ 111.195 km (textbook value)
    d = haversine_m(0, 0, 1, 0)
    assert 111_100 < d < 111_300, f"haversine 1deg lat wrong: {d}"
    print("  haversine OK")

    # 2. Pit filling: a bowl in a flat plain fills to plateau elevation,
    #    plus a tiny epsilon gradient radiating outward from the spillway.
    elev = np.ones((10, 10), dtype=np.float32) * 100.0
    elev[5, 5] = 50.0
    filled = priority_flood_fill(elev)
    assert abs(filled[5, 5] - 100.0) < 1.0, f"pit not filled: {filled[5, 5]}"
    assert filled[0, 0] == 100.0, "edge should not change"
    print("  priority-flood OK")

    # 3. Cone DEM: flow direction from center should go outward to edge.
    size = 21
    center = size // 2
    cone = np.zeros((size, size), dtype=np.float32)
    for r in range(size):
        for c in range(size):
            cone[r, c] = math.hypot(r - center, c - center)
    dem = (cone.max() - cone).astype(np.float32)
    filled = priority_flood_fill(dem)
    d8 = compute_d8(filled)
    walk = walk_downhill(d8, center + 1, center + 1, max_steps=100)
    final_r, final_c = walk[-1]
    on_border = (
        final_r == 0 or final_r == size - 1 or final_c == 0 or final_c == size - 1
    )
    assert on_border, (
        f"cone walk did not reach a border edge: final={final_r},{final_c}"
    )
    assert len(walk) >= center, f"cone walk too short: {len(walk)}"
    print("  cone walk OK")

    # 4. LAKE TEST — this is the test that would have failed before the
    #    epsilon fix. A flat-bottomed bowl carved into a slope: the lake
    #    itself has identical elevation across many cells. After fill +
    #    D8, a seed cell deep INSIDE the lake must still be able to walk
    #    out through the spillway.
    lake_size = 30
    slope = np.zeros((lake_size, lake_size), dtype=np.float32)
    for r in range(lake_size):
        for c in range(lake_size):
            slope[r, c] = (lake_size - r) * 2.0  # slopes south (down as r grows)
    # Carve a 7×7 flat-bottomed pit from rows 5-11, cols 10-16.
    slope[5:12, 10:17] = 5.0
    filled = priority_flood_fill(slope)
    d8 = compute_d8(filled)
    # Seed at the center of the lake — must walk out.
    seed_row, seed_col = 8, 13
    assert d8[seed_row, seed_col] >= 0, (
        "lake center has d8=-1 — epsilon fill is broken, walk would die at source"
    )
    walk = walk_downhill(d8, seed_row, seed_col, max_steps=200)
    assert len(walk) > 10, f"lake walk did not escape the basin: len={len(walk)}"
    # Final cell should be well south of the lake (downhill direction).
    final_r, _ = walk[-1]
    assert final_r > 12, f"lake walk did not flow south: final_r={final_r}"
    print("  lake walk OK")

    # 5. find_seed_cell: nearest ring with valid D8 when seed is on border.
    tiny_d8 = np.full((5, 5), -1, dtype=np.int8)
    tiny_d8[2, 2] = 4  # valid direction at center
    r, c = find_seed_cell(tiny_d8, 0, 0, search_radius=4)
    assert (r, c) == (2, 2), f"find_seed_cell did not find valid cell: {r},{c}"
    print("  find_seed_cell OK")

    # 6. RDP: a straight line with micro-noise should collapse to 2 points.
    line = [(0.0 + 0.000001 * math.sin(i), i * 0.001) for i in range(100)]
    simplified = rdp_simplify(line, tolerance_m=5.0)
    assert len(simplified) == 2, f"RDP did not collapse straight line: {len(simplified)}"
    print("  RDP collapse OK")

    # 7. RDP: a right angle at midpoint should keep at least 3 points.
    corner = [(0.0, 0.0), (0.0, 0.5), (0.0, 1.0), (0.5, 1.0), (1.0, 1.0)]
    simplified = rdp_simplify(corner, tolerance_m=5.0)
    assert len(simplified) >= 3, f"RDP lost the corner: {len(simplified)}"
    print("  RDP corner OK")

    # 8. Catmull-Rom: smoothed curve passes through ALL control points.
    control = [(0.0, 0.0), (1.0, 2.0), (2.0, 1.5), (3.0, 3.0)]
    spp = 4
    smoothed = catmull_rom_smooth(control, samples_per_segment=spp)
    # Expected control-point indices in output: [0, spp, 2*spp, 3*spp]
    for idx, ctrl in enumerate(control):
        out_idx = idx * spp
        assert abs(smoothed[out_idx][0] - ctrl[0]) < 1e-6, (
            f"Catmull-Rom did not pass through control[{idx}]: "
            f"got {smoothed[out_idx]}, expected {ctrl}"
        )
        assert abs(smoothed[out_idx][1] - ctrl[1]) < 1e-6, (
            f"Catmull-Rom y mismatch at control[{idx}]"
        )
    assert len(smoothed) == 3 * spp + 1, f"unexpected sample count: {len(smoothed)}"
    print("  Catmull-Rom OK")

    # 9. latlon_to_cell: out-of-bounds raises.
    dummy = DemMosaic(
        elev=np.zeros((100, 100), dtype=np.float64),
        zoom=12,
        tile_x_min=2000,
        tile_y_min=1500,
        height=100,
        width=100,
    )
    try:
        dummy.latlon_to_cell(0.0, 0.0)
        raise AssertionError("latlon_to_cell should have raised")
    except ValueError:
        pass
    print("  latlon_to_cell bounds OK")

    print("all tests passed")


if __name__ == "__main__":
    _selftest()
