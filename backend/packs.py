"""
Pack discovery and loading for Moraine's regional lake data packs.

Each pack is a folder containing:
  - manifest.json  (PackManifest schema)
  - lakes.json     (same schema as legacy data/lakes.json)

Two discovery locations:
  1. Bundled packs — ship with the app, read-only
     Dev:  <project_root>/packs/
     Prod: Tauri app resource dir (handled by Tauri, same layout)
  2. User packs — downloaded at runtime, stored under the platform
     app data dir via `platformdirs`:
       macOS:   ~/Library/Application Support/dev.moraine.glof/packs/
       Windows: %APPDATA%\\dev.moraine.glof\\packs\\
       Linux:   ~/.local/share/dev.moraine.glof/packs/

When both a bundled and a user pack share an `id`, the USER pack wins.
This is how remote updates work — Phase 4 drops a newer manifest into
the user packs dir and the next discover_packs() call picks it up in
preference to the bundled copy.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import httpx
import platformdirs

from backend.schemas import (
    InstallResult,
    Pack,
    PackManifest,
    PackUpdate,
    RemotePackEntry,
    UpdateReport,
)

log = logging.getLogger(__name__)

# Project root — used to locate bundled packs in dev mode. packs.py lives
# at <project_root>/backend/packs.py so the root is one directory up.
PROJECT_ROOT = Path(__file__).parent.parent

# Tauri identifier; keep in sync with src-tauri/tauri.conf.json "identifier".
# platformdirs resolves this to the standard per-platform app data dir.
APP_IDENTIFIER = "dev.moraine.glof"

# Pack ids must be restricted to this character set. We use the id as a
# directory name when resolving user/bundled pack dirs, so anything outside
# this whitelist would allow path traversal (e.g. "../foo").
_PACK_ID_RE = re.compile(r"^[a-z0-9_]+$")

# Module-level cache. Populated on first discover_packs() call and reused
# until invalidate_cache() is called (e.g. after a remote update install
# writes a new pack dir in Phase 4).
_packs_cache: list[Pack] | None = None


def _is_safe_pack_id(pack_id: str) -> bool:
    """Return True if pack_id is safe to use as a directory name."""
    return bool(_PACK_ID_RE.match(pack_id))


def get_bundled_packs_dir() -> Path:
    """
    Return the directory that holds bundled (read-only) packs.

    In development this is <project_root>/packs/. In a Tauri production
    build the same relative layout is reproduced inside the app resource
    bundle because tauri.conf.json copies ../packs/**/* into resources.
    """
    return PROJECT_ROOT / "packs"


def get_user_packs_dir() -> Path:
    """
    Return the directory where user-installed packs live.

    Uses platformdirs so the path matches platform conventions:
      macOS:   ~/Library/Application Support/dev.moraine.glof/packs
      Windows: %APPDATA%\\dev.moraine.glof\\packs
      Linux:   ~/.local/share/dev.moraine.glof/packs

    The directory is created lazily — we don't force it to exist here
    because a user who hasn't installed any packs should not leave an
    empty folder in their app data dir.
    """
    base = Path(platformdirs.user_data_dir(APP_IDENTIFIER))
    return base / "packs"


def _load_manifest(pack_dir: Path) -> PackManifest | None:
    """
    Load and validate a pack's manifest.json. Returns None and logs a
    warning if the file is missing, malformed, or fails validation.
    """
    manifest_path = pack_dir / "manifest.json"
    if not manifest_path.is_file():
        log.warning("Skipping %s: no manifest.json", pack_dir)
        return None
    try:
        with open(manifest_path, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        log.warning("Skipping %s: failed to read manifest.json (%s)", pack_dir, e)
        return None
    try:
        return PackManifest(**raw)
    except Exception as e:
        # Pydantic ValidationError or similar — manifest structure is wrong.
        log.warning("Skipping %s: manifest.json failed validation (%s)", pack_dir, e)
        return None


def _scan_dir(root: Path, *, is_bundled: bool) -> list[Pack]:
    """
    Walk `root` looking for pack subdirectories. Each subdirectory whose
    manifest.json loads successfully becomes a Pack.
    """
    if not root.is_dir():
        return []
    found: list[Pack] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        pack_id_from_dir = entry.name
        # Defense in depth: even though iterdir only returns direct
        # children, we still validate the directory name so an
        # unexpected name like ".." or "foo/bar" can never slip through
        # if callers ever resolve by id later.
        if not _is_safe_pack_id(pack_id_from_dir):
            log.warning("Skipping pack dir with unsafe name: %s", entry)
            continue
        manifest = _load_manifest(entry)
        if manifest is None:
            continue
        # Sanity check: manifest id should match directory name. If it
        # doesn't we trust the manifest but log — this keeps discovery
        # resilient while still surfacing authoring mistakes.
        if manifest.id != pack_id_from_dir:
            log.warning(
                "Pack dir %s contains manifest with id=%s (mismatch)",
                entry,
                manifest.id,
            )
        if not _is_safe_pack_id(manifest.id):
            log.warning("Skipping pack with unsafe manifest id: %s", manifest.id)
            continue
        found.append(
            Pack(
                manifest=manifest,
                is_bundled=is_bundled,
                is_user_installed=not is_bundled,
                path=str(entry),
            )
        )
    return found


def discover_packs() -> list[Pack]:
    """
    Discover all installed packs across bundled + user dirs.

    Caching: result is memoized in _packs_cache until invalidate_cache()
    is called. The Phase 4 remote update flow calls invalidate_cache()
    after writing a new pack to disk so the next call picks up the new
    version.

    User pack wins on id conflict — we scan the user dir AFTER the
    bundled dir and let user packs overwrite earlier entries in a dict
    keyed by pack id. This way "installing an update" just means
    dropping a newer version of the same id into the user packs dir.
    """
    global _packs_cache
    if _packs_cache is not None:
        return _packs_cache

    by_id: dict[str, Pack] = {}
    bundled = _scan_dir(get_bundled_packs_dir(), is_bundled=True)
    for pack in bundled:
        by_id[pack.manifest.id] = pack

    user = _scan_dir(get_user_packs_dir(), is_bundled=False)
    for pack in user:
        # User pack overrides bundled pack with the same id.
        by_id[pack.manifest.id] = pack

    packs = list(by_id.values())
    total_lakes = sum(p.manifest.lake_count for p in packs)
    log.info(
        "Discovered %d pack(s) with %d total lakes: %s",
        len(packs),
        total_lakes,
        ", ".join(p.manifest.id for p in packs) or "(none)",
    )
    _packs_cache = packs
    return packs


def load_lakes_from_packs(packs: list[Pack]) -> list[dict]:
    """
    Load `lakes.json` from each pack and return one flat list of lake
    dicts. Each lake dict is annotated with a `pack_id` field naming
    the pack it came from, so downstream code (e.g. the frontend region
    filter) can group lakes by region. The `Lake` Pydantic schema
    declares `pack_id` as an optional field so it flows straight
    through `/api/lakes` to the client.

    Errors in an individual pack's lakes.json are logged and skipped —
    we don't want one bad pack to take down the whole app.
    """
    all_lakes: list[dict] = []
    for pack in packs:
        lakes_path = Path(pack.path) / "lakes.json"
        if not lakes_path.is_file():
            log.warning(
                "Pack %s has no lakes.json at %s — skipping",
                pack.manifest.id,
                lakes_path,
            )
            continue
        try:
            with open(lakes_path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            log.warning(
                "Failed to read %s for pack %s: %s",
                lakes_path,
                pack.manifest.id,
                e,
            )
            continue
        lakes = data.get("lakes")
        if not isinstance(lakes, list):
            log.warning(
                "Pack %s lakes.json has no 'lakes' list — skipping",
                pack.manifest.id,
            )
            continue
        for lake in lakes:
            if not isinstance(lake, dict):
                continue
            # Tag the lake with its source pack id. The Lake schema
            # exposes this as a public field so the frontend can filter
            # by active region without an extra round-trip.
            lake["pack_id"] = pack.manifest.id
            all_lakes.append(lake)
    return all_lakes


def invalidate_cache() -> None:
    """
    Clear the cached pack list so the next discover_packs() call
    re-scans disk. Called by Phase 4 remote-update handlers after
    writing a new pack dir.
    """
    global _packs_cache
    _packs_cache = None


# ── Phase 4: Remote update flow ───────────────────────────────────────────
#
# The "Check for updates" button in the Region Manager UI fetches a small
# JSON index from a pinned URL (PACK_REGISTRY_URL in backend/config.py),
# compares versions against locally installed packs, and offers to
# download newer versions or brand-new packs.
#
# Network I/O lives entirely in Python — no Tauri permissions needed.
# Once a pack is installed it lives on disk in the user packs dir, so
# the app continues to work fully offline between update checks.


def _semver_key(version: str) -> tuple:
    """
    Return a sortable tuple for a semantic-version-ish string. Falls back
    to lexicographic comparison for anything that doesn't parse cleanly.
    Used to decide whether a remote version is newer than the installed one.
    """
    try:
        return tuple(int(p) for p in version.split("."))
    except (ValueError, AttributeError):
        return (version,)


def _is_newer(remote: str, installed: str) -> bool:
    """Return True if `remote` is a strictly newer version than `installed`."""
    if remote == installed:
        return False
    try:
        return _semver_key(remote) > _semver_key(installed)
    except TypeError:
        # Mixed types (e.g., one parsed as int tuple, the other as string).
        # Be conservative: only suggest an update when we're sure.
        return remote != installed and remote > installed


def check_remote_updates(index_url: str, timeout: float = 10.0) -> UpdateReport:
    """
    Fetch the remote pack registry and compare it against installed packs.

    Returns an UpdateReport with three buckets:
      - updates_available: packs the user already has, but at older versions
      - new_packs: packs the user doesn't have at all
      - already_current: packs whose installed version matches the remote

    Network errors are captured in the `error` field rather than raised so
    the UI can gracefully show "couldn't check for updates" instead of a
    500. The app continues to work offline either way.
    """
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report = UpdateReport(
        checked_at=now_iso,
        registry_url=index_url,
        updates_available=[],
        new_packs=[],
        already_current=[],
    )
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(index_url)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as e:
        report.error = f"Failed to fetch registry: {e}"
        return report
    except json.JSONDecodeError as e:
        report.error = f"Registry returned invalid JSON: {e}"
        return report

    raw_packs = data.get("packs")
    if not isinstance(raw_packs, list):
        report.error = "Registry index has no 'packs' list"
        return report

    # Build a lookup of installed packs by id → version
    installed_by_id: dict[str, str] = {}
    for pack in discover_packs():
        installed_by_id[pack.manifest.id] = pack.manifest.version

    for raw in raw_packs:
        try:
            entry = RemotePackEntry(**raw)
        except Exception as e:
            log.warning("Skipping malformed registry entry: %s", e)
            continue
        if not _is_safe_pack_id(entry.id):
            log.warning("Skipping registry entry with unsafe id: %s", entry.id)
            continue
        installed_version = installed_by_id.get(entry.id)
        if installed_version is None:
            report.new_packs.append(entry)
        elif _is_newer(entry.version, installed_version):
            report.updates_available.append(
                PackUpdate(
                    id=entry.id,
                    name=entry.name,
                    installed_version=installed_version,
                    available_version=entry.version,
                    lake_count=entry.lake_count,
                    released=entry.released,
                )
            )
        else:
            report.already_current.append(entry.id)

    return report


def install_pack_from_remote(
    pack_id: str,
    timeout: float = 10.0,
    index_url: str | None = None,
) -> InstallResult:
    """
    Download a pack by id from the remote registry and install it to the
    user packs dir.

    Steps:
      1. Fetch the registry index and find the entry with matching id
      2. Download the manifest.json and lakes.json from the URLs in the entry
      3. Verify the lakes.json sha256 against the index entry
      4. Atomically write to <user_packs_dir>/<pack_id>/ via tmp + os.replace
      5. Invalidate caches so the next /api/lakes call picks up the new data

    Returns an InstallResult; failures are reported in the `error` field
    rather than raised, so the UI can show a friendly message.
    """
    if not _is_safe_pack_id(pack_id):
        return InstallResult(
            success=False,
            pack_id=pack_id,
            error=f"Unsafe pack id: {pack_id!r}",
        )

    # Default to the configured registry. We accept an explicit override
    # so tests don't depend on the global config.
    if index_url is None:
        from backend.config import PACK_REGISTRY_URL
        index_url = PACK_REGISTRY_URL

    try:
        with httpx.Client(timeout=timeout) as client:
            # 1. Fetch the index
            try:
                idx_response = client.get(index_url)
                idx_response.raise_for_status()
                idx_data = idx_response.json()
            except httpx.HTTPError as e:
                return InstallResult(
                    success=False,
                    pack_id=pack_id,
                    error=f"Could not fetch registry index: {e}",
                )

            entries = idx_data.get("packs", [])
            entry_raw = next((e for e in entries if e.get("id") == pack_id), None)
            if entry_raw is None:
                return InstallResult(
                    success=False,
                    pack_id=pack_id,
                    error=f"Pack {pack_id!r} not found in registry",
                )
            try:
                entry = RemotePackEntry(**entry_raw)
            except Exception as e:
                return InstallResult(
                    success=False,
                    pack_id=pack_id,
                    error=f"Registry entry malformed: {e}",
                )

            # 2. Download manifest + lakes
            try:
                manifest_response = client.get(entry.manifest_url)
                manifest_response.raise_for_status()
                manifest_bytes = manifest_response.content

                lakes_response = client.get(entry.lakes_url)
                lakes_response.raise_for_status()
                lakes_bytes = lakes_response.content
            except httpx.HTTPError as e:
                return InstallResult(
                    success=False,
                    pack_id=pack_id,
                    error=f"Failed to download pack files: {e}",
                )
    except Exception as e:
        # Catch-all so any unexpected error becomes a clean error result
        # rather than a 500.
        return InstallResult(
            success=False,
            pack_id=pack_id,
            error=f"Unexpected error during fetch: {e}",
        )

    # 3. Verify sha256 of lakes.json against the index entry. We hash the
    # file as it was downloaded — there's no point trusting the manifest
    # since the manifest itself came from the same place.
    actual_sha = hashlib.sha256(lakes_bytes).hexdigest()
    if actual_sha != entry.sha256:
        return InstallResult(
            success=False,
            pack_id=pack_id,
            error=(
                f"sha256 mismatch for {pack_id} lakes.json: "
                f"expected {entry.sha256[:16]}…, got {actual_sha[:16]}…"
            ),
        )

    # Validate the manifest can be loaded as a real PackManifest before
    # we touch disk. We don't want to install an unparseable pack.
    try:
        manifest_data = json.loads(manifest_bytes)
        manifest = PackManifest(**manifest_data)
    except (json.JSONDecodeError, Exception) as e:
        return InstallResult(
            success=False,
            pack_id=pack_id,
            error=f"Downloaded manifest is invalid: {e}",
        )

    # 4. Atomically write to disk. We stage in a sibling directory inside
    # the user packs dir, then os.replace() the whole thing into place so
    # a crashed install never leaves a half-written pack.
    user_packs_dir = get_user_packs_dir()
    user_packs_dir.mkdir(parents=True, exist_ok=True)
    target_dir = user_packs_dir / pack_id

    # Stage in a temp dir as a sibling of the target so the final
    # os.replace stays on the same filesystem.
    staging_parent = tempfile.mkdtemp(
        prefix=f".moraine-install-{pack_id}-", dir=str(user_packs_dir)
    )
    try:
        staging_dir = Path(staging_parent) / pack_id
        staging_dir.mkdir()
        (staging_dir / "manifest.json").write_bytes(manifest_bytes)
        (staging_dir / "lakes.json").write_bytes(lakes_bytes)

        # If a previous version of the pack is already installed in the
        # user dir, replace it atomically. shutil.rmtree the old one,
        # then rename the staging dir into place. The brief window where
        # neither exists is acceptable — concurrent reads will simply
        # see the stale cache via discover_packs() until invalidate_cache().
        if target_dir.exists():
            shutil.rmtree(target_dir)
        os.replace(str(staging_dir), str(target_dir))
    finally:
        # Always clean up the (now-empty) staging parent dir.
        try:
            shutil.rmtree(staging_parent, ignore_errors=True)
        except Exception:
            pass

    # 5. Invalidate caches so the next /api/lakes call re-scans disk.
    invalidate_cache()

    return InstallResult(
        success=True,
        pack_id=pack_id,
        installed_version=manifest.version,
        installed_lake_count=manifest.lake_count,
        install_path=str(target_dir),
    )
