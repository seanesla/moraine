from fastapi import APIRouter

from backend.dependencies import get_lakes_db
from backend.schemas import Lake

router = APIRouter(prefix="/api", tags=["lakes"])


@router.get("/lakes", response_model=list[Lake])
def list_lakes():
    """Return all lakes in the database."""
    return get_lakes_db()
