"""
Offline map tile manager for the GLOF app.

Downloads OpenTopoMap tiles for a lake's region and serves them
locally via a Flask server in a daemon thread. Once downloaded,
maps work completely offline.

Tile storage: ~35-50MB per lake region at zoom levels 10-14.
"""

import math
import os
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

import mercantile
import requests

TILES_DIR = Path(os.path.dirname(__file__)) / "data" / "tiles"

# OpenTopoMap — topographic tiles, great for mountain terrain
# License: CC-BY-SA (free for offline use with attribution)
TILE_URL_TEMPLATE = "https://tile.opentopomap.org/{z}/{x}/{y}.png"

# Respectful request headers
HEADERS = {
    "User-Agent": "Moraine-GLOF-App/1.0 (disaster-response-tool; contact: github.com/moraine)",
}

ZOOM_RANGE = (10, 14)


def get_lake_bounds(lake_data: dict, padding_deg: float = 0.1) -> tuple:
    """
    Compute a bounding box around a lake and all its villages.

    Args:
        lake_data: Lake dict from lakes.json (must have lat, lon, villages with lat/lon).
        padding_deg: Extra padding in degrees (~11km per 0.1 degree).

    Returns:
        (west, south, east, north) bounding box.
    """
    lats = [lake_data["lat"]]
    lons = [lake_data["lon"]]

    for v in lake_data.get("villages", []):
        if "lat" in v and "lon" in v:
            lats.append(v["lat"])
            lons.append(v["lon"])

    return (
        min(lons) - padding_deg,
        min(lats) - padding_deg,
        max(lons) + padding_deg,
        max(lats) + padding_deg,
    )


def count_tiles(bounds: tuple, zoom_range: tuple = ZOOM_RANGE) -> int:
    """Count how many tiles a download would require."""
    total = 0
    west, south, east, north = bounds
    for z in range(zoom_range[0], zoom_range[1] + 1):
        tiles = list(mercantile.tiles(west, south, east, north, zooms=z))
        total += len(tiles)
    return total


def tiles_exist(lake_id: str) -> bool:
    """Check if tiles are already cached for a lake."""
    lake_dir = TILES_DIR / lake_id
    if not lake_dir.exists():
        return False
    # Check if we have at least some tiles at the highest zoom level
    highest_zoom = ZOOM_RANGE[1]
    zoom_dir = lake_dir / str(highest_zoom)
    if not zoom_dir.exists():
        return False
    # Count PNGs recursively in the zoom dir
    png_count = len(list(zoom_dir.rglob("*.png")))
    return png_count > 0


def download_tiles(
    lake_id: str,
    bounds: tuple,
    zoom_range: tuple = ZOOM_RANGE,
    progress_callback=None,
) -> int:
    """
    Download map tiles for a lake region.

    Args:
        lake_id: Lake identifier (used as directory name).
        bounds: (west, south, east, north) bounding box.
        zoom_range: (min_zoom, max_zoom) inclusive.
        progress_callback: Optional callable(downloaded, total) for progress tracking.

    Returns:
        Number of tiles downloaded.
    """
    lake_dir = TILES_DIR / lake_id
    west, south, east, north = bounds

    # Collect all tiles across zoom levels
    all_tiles = []
    for z in range(zoom_range[0], zoom_range[1] + 1):
        all_tiles.extend(mercantile.tiles(west, south, east, north, zooms=z))

    total = len(all_tiles)
    downloaded = 0
    skipped = 0

    session = requests.Session()
    session.headers.update(HEADERS)

    for tile in all_tiles:
        tile_path = lake_dir / f"{tile.z}/{tile.x}/{tile.y}.png"

        # Skip if already downloaded
        if tile_path.exists():
            skipped += 1
            downloaded += 1
            if progress_callback:
                progress_callback(downloaded, total)
            continue

        tile_path.parent.mkdir(parents=True, exist_ok=True)

        url = TILE_URL_TEMPLATE.format(z=tile.z, x=tile.x, y=tile.y)
        try:
            resp = session.get(url, timeout=10)
            if resp.status_code == 200:
                tile_path.write_bytes(resp.content)
            downloaded += 1
        except requests.RequestException:
            downloaded += 1  # Count as attempted

        if progress_callback:
            progress_callback(downloaded, total)

    return total - skipped  # Actually downloaded (not skipped)


def _find_free_port() -> int:
    """Find a free port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


# Track running servers to avoid duplicates
_running_servers = {}


def start_tile_server(lake_id: str) -> str | None:
    """
    Start a local HTTP server serving tiles for a lake.

    Returns the tile URL template (e.g., "http://localhost:PORT/{z}/{x}/{y}.png")
    or None if tiles don't exist.
    """
    if not tiles_exist(lake_id):
        return None

    # Return existing server if already running
    if lake_id in _running_servers:
        port = _running_servers[lake_id]
        return f"http://localhost:{port}/{{z}}/{{x}}/{{y}}.png"

    lake_dir = TILES_DIR / lake_id
    port = _find_free_port()

    class TileHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(lake_dir), **kwargs)

        def log_message(self, format, *args):
            pass  # Suppress log output

    server = HTTPServer(("localhost", port), TileHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    _running_servers[lake_id] = port
    return f"http://localhost:{port}/{{z}}/{{x}}/{{y}}.png"
