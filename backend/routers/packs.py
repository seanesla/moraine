"""
/api/packs router — exposes installed regional lake packs and the
remote update flow ("check for updates" + "install").
"""

from fastapi import APIRouter
from pydantic import BaseModel

from backend import packs as packs_module
from backend.config import PACK_REGISTRY_HTTP_TIMEOUT, PACK_REGISTRY_URL
from backend.dependencies import get_packs_db, invalidate_lakes_db_cache
from backend.schemas import (
    InstallRequest,
    InstallResult,
    PackManifest,
    UpdateReport,
)

router = APIRouter(prefix="/api", tags=["packs"])


class PackResponse(BaseModel):
    """
    Public representation of a Pack. This mirrors the internal Pack
    schema from backend/schemas.py but deliberately omits the filesystem
    `path` field — clients don't need it and leaking absolute paths is
    a gratuitous information disclosure.
    """

    manifest: PackManifest
    is_bundled: bool
    is_user_installed: bool


@router.get("/packs", response_model=list[PackResponse])
def list_packs():
    """Return all installed packs (bundled + user-installed)."""
    packs = get_packs_db()
    return [
        PackResponse(
            manifest=p.manifest,
            is_bundled=p.is_bundled,
            is_user_installed=p.is_user_installed,
        )
        for p in packs
    ]


@router.get("/packs/check_updates", response_model=UpdateReport)
def check_updates():
    """
    Fetch the remote pack registry and report which installed packs have
    newer versions available, plus any brand-new packs the user could
    install. Network errors are reported in the `error` field rather
    than raised so the UI can degrade gracefully.
    """
    return packs_module.check_remote_updates(
        index_url=PACK_REGISTRY_URL,
        timeout=PACK_REGISTRY_HTTP_TIMEOUT,
    )


@router.post("/packs/install", response_model=InstallResult)
def install_pack(req: InstallRequest):
    """
    Download and install a single pack from the remote registry. The
    pack ends up in the user packs dir, where it overrides any bundled
    version with the same id. The lakes/packs caches are invalidated so
    the next call to /api/lakes or /api/packs reflects the new pack.
    """
    result = packs_module.install_pack_from_remote(
        pack_id=req.pack_id,
        timeout=PACK_REGISTRY_HTTP_TIMEOUT,
        index_url=PACK_REGISTRY_URL,
    )
    if result.success:
        # Belt + suspenders: install_pack_from_remote already calls
        # invalidate_cache() but the dependencies layer has its own
        # _lakes_db cache. Clear that too so /api/lakes is fresh.
        invalidate_lakes_db_cache()
    return result
