#!/usr/bin/env python3
"""
Build a per-pack hillshade raster for offline use.

Usage:
    python3 scripts/build_pack_hillshade.py <pack_id>
    python3 scripts/build_pack_hillshade.py hkh

Fetches Mapzen/AWS Terrarium tiles (open data, no API key) covering the
pack's region_bounds at a fixed zoom level, decodes them to elevation,
computes a multidirectional Lambertian hillshade with a dark color ramp,
and writes packs/<pack_id>/hillshade.webp.

The generated WebP is bundled with the Tauri app via tauri.conf.json's
`bundle.resources` entry and loaded at runtime by HillshadeLayer.tsx.
Run this once per pack you want offline terrain for — no automation.

Dependencies (NOT auto-installed):
    pip install requests pillow numpy

Exits with non-zero status if a dep is missing or a tile fails to fetch.
The Moraine app still works fine without this file — the HillshadeLayer
silently falls back to a flat background.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from io import BytesIO
from pathlib import Path

try:
    import numpy as np
    import requests
    from PIL import Image
except ImportError as exc:
    print(f"ERROR: missing Python dep: {exc.name}", file=sys.stderr)
    print("Install with: pip install requests pillow numpy", file=sys.stderr)
    sys.exit(2)


TILE_URL = (
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
)
ZOOM = 8
TILE_PX = 256
# Downscale factor — keep the WebP small even for continent-scale packs.
OUTPUT_SCALE = 0.5


def latlon_to_tile(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int(
        (
            1.0
            - math.log(
                math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))
            )
            / math.pi
        )
        / 2.0
        * n
    )
    return x, y


def fetch_tile(z: int, x: int, y: int) -> Image.Image:
    url = TILE_URL.format(z=z, x=x, y=y)
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return Image.open(BytesIO(r.content)).convert("RGB")


def decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    # Terrarium encoding: height = (R*256 + G + B/256) - 32768
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)
    return r * 256.0 + g + b / 256.0 - 32768.0


def compute_hillshade(
    elev: np.ndarray, azimuth: float = 315.0, altitude: float = 45.0
) -> np.ndarray:
    # Lambertian shading with gradient from elevation raster.
    az = math.radians(360.0 - azimuth + 90.0)
    alt = math.radians(altitude)
    dy, dx = np.gradient(elev)
    slope = math.pi / 2.0 - np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    shaded = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(
        az - aspect
    )
    return np.clip(shaded, 0.0, 1.0)


def dark_color_ramp(shaded: np.ndarray) -> np.ndarray:
    # Dark navy shadows -> slate midtones -> pale cyan highlights.
    # Applied as a piecewise linear mix on the 0..1 shade value.
    shadow = np.array([10, 12, 24], dtype=np.float32)  # #0a0c18
    mid = np.array([50, 58, 82], dtype=np.float32)  # #323a52
    high = np.array([170, 190, 210], dtype=np.float32)  # #aabed2
    t = shaded[..., None]
    lower = shadow + (mid - shadow) * (t * 2.0).clip(0.0, 1.0)
    upper = mid + (high - mid) * ((t - 0.5) * 2.0).clip(0.0, 1.0)
    rgb = np.where(t < 0.5, lower, upper)
    return rgb.astype(np.uint8)


def build_pack(pack_id: str) -> None:
    repo_root = Path(__file__).resolve().parent.parent
    pack_dir = repo_root / "packs" / pack_id
    manifest_path = pack_dir / "manifest.json"
    if not manifest_path.exists():
        print(f"ERROR: {manifest_path} not found", file=sys.stderr)
        sys.exit(1)

    manifest = json.loads(manifest_path.read_text())
    bounds = manifest.get("region_bounds")
    if not bounds:
        print(f"ERROR: pack '{pack_id}' has no region_bounds in manifest", file=sys.stderr)
        sys.exit(1)

    min_lat = bounds["min_lat"]
    max_lat = bounds["max_lat"]
    min_lon = bounds["min_lon"]
    max_lon = bounds["max_lon"]

    # Tile range. Note Y increases southward in web mercator, so the
    # tile covering max_lat has the SMALLER y.
    x0, y1 = latlon_to_tile(min_lat, min_lon, ZOOM)
    x1, y0 = latlon_to_tile(max_lat, max_lon, ZOOM)
    x_range = range(min(x0, x1), max(x0, x1) + 1)
    y_range = range(min(y0, y1), max(y0, y1) + 1)

    width = len(x_range) * TILE_PX
    height = len(y_range) * TILE_PX
    total = len(x_range) * len(y_range)
    print(f"Pack {pack_id}: {total} tiles at zoom {ZOOM} ({width}x{height}px)")

    # Stitch tiles into a single RGB mosaic.
    mosaic = Image.new("RGB", (width, height))
    fetched = 0
    for iy, y in enumerate(y_range):
        for ix, x in enumerate(x_range):
            try:
                tile = fetch_tile(ZOOM, x, y)
            except Exception as e:
                print(f"  tile {ZOOM}/{x}/{y} failed: {e}", file=sys.stderr)
                continue
            mosaic.paste(tile, (ix * TILE_PX, iy * TILE_PX))
            fetched += 1
            if fetched % 10 == 0:
                print(f"  fetched {fetched}/{total}")
    print(f"  fetched {fetched}/{total} tiles")

    # Decode to elevation, compute hillshade, color-ramp, downscale, write.
    rgb = np.array(mosaic)
    elev = decode_terrarium(rgb)
    shaded = compute_hillshade(elev)
    colored = dark_color_ramp(shaded)
    out_img = Image.fromarray(colored, mode="RGB")
    if OUTPUT_SCALE != 1.0:
        new_size = (
            max(1, int(out_img.width * OUTPUT_SCALE)),
            max(1, int(out_img.height * OUTPUT_SCALE)),
        )
        out_img = out_img.resize(new_size, Image.LANCZOS)

    out_path = pack_dir / "hillshade.webp"
    out_img.save(out_path, "WEBP", quality=78, method=6)
    size_bytes = out_path.stat().st_size
    sha256 = hashlib.sha256(out_path.read_bytes()).hexdigest()
    print(f"Wrote {out_path} ({size_bytes / 1024:.1f} KB)")

    # Patch manifest with spatial metadata so other tooling can find it.
    spatial = manifest.setdefault("spatial", {})
    spatial["hillshade"] = {
        "file": "hillshade.webp",
        "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
        "size_bytes": size_bytes,
        "sha256": sha256,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Updated {manifest_path}")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: build_pack_hillshade.py <pack_id>", file=sys.stderr)
        return 1
    build_pack(argv[1])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
