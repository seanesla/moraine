from fastapi import APIRouter, HTTPException

from backend.dependencies import get_lakes_db
from backend.schemas import TileStatus

router = APIRouter(prefix="/api/tiles", tags=["tiles"])


def _find_lake(lake_id: str) -> dict:
    for lake in get_lakes_db():
        if lake["id"] == lake_id:
            return lake
    raise HTTPException(status_code=404, detail=f"Lake '{lake_id}' not found")


@router.get("/status/{lake_id}", response_model=TileStatus)
def tile_status(lake_id: str):
    """Check if offline tiles are cached for a lake."""
    import tile_manager

    _find_lake(lake_id)  # validate lake exists
    cached = tile_manager.tiles_exist(lake_id)
    tile_url = None

    if cached:
        tile_url = tile_manager.start_tile_server(lake_id)

    return TileStatus(cached=cached, tile_url=tile_url)


@router.post("/download/{lake_id}")
def download_tiles(lake_id: str):
    """Download offline map tiles for a lake. Returns count when done."""
    import tile_manager

    lake = _find_lake(lake_id)
    bounds = tile_manager.get_lake_bounds(lake)
    count = tile_manager.download_tiles(lake_id, bounds)
    tile_url = tile_manager.start_tile_server(lake_id)

    return {"downloaded": count, "tile_url": tile_url}
