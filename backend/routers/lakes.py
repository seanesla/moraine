from fastapi import APIRouter, HTTPException

from backend.dependencies import get_lakes_db
from backend.schemas import Lake

router = APIRouter(prefix="/api", tags=["lakes"])


@router.get("/lakes", response_model=list[Lake])
def list_lakes():
    """Return all lakes in the database."""
    return get_lakes_db()


@router.get("/lakes/{lake_id}", response_model=Lake)
def get_lake(lake_id: str):
    """Return a single lake by its ID."""
    for lake in get_lakes_db():
        if lake["id"] == lake_id:
            return lake
    raise HTTPException(status_code=404, detail=f"Lake '{lake_id}' not found")
