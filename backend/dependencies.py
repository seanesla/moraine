import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Add the project root to sys.path so we can import glof_core, runners, etc.
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

load_dotenv(PROJECT_ROOT / ".env")

from backend import packs as packs_module
from backend.schemas import Pack

# Lazy-loaded singletons
_lakes_db: list[dict] | None = None
_runner = None


def get_lakes_db() -> list[dict]:
    """
    Return the full lake database as a flat list of dicts.

    Backed by the pack system: we call packs.discover_packs() to find all
    bundled + user-installed packs, then merge each pack's lakes.json
    into one list. Each lake carries a `pack_id` field naming its source
    pack — that field is part of the public Lake schema so the frontend
    can filter by active region.

    Cached after first call. Callers that need to force a reload (e.g.
    after a Phase 4 remote update installs a new pack) should call
    invalidate_lakes_db_cache() below.
    """
    global _lakes_db
    if _lakes_db is None:
        discovered = packs_module.discover_packs()
        _lakes_db = packs_module.load_lakes_from_packs(discovered)
    return _lakes_db


def get_packs_db() -> list[Pack]:
    """
    Return the list of installed Pack objects (bundled + user).

    Used by the /api/packs router. Delegates directly to the pack
    module which maintains its own cache.
    """
    return packs_module.discover_packs()


def invalidate_lakes_db_cache() -> None:
    """
    Clear the cached lake DB so the next get_lakes_db() call re-scans
    packs from disk. Also invalidates the underlying pack cache. Used
    by Phase 4 remote-update install handlers.
    """
    global _lakes_db
    _lakes_db = None
    packs_module.invalidate_cache()


def get_runner():
    """
    Get or create the LLM runner (Gemini or Ollama).
    Tries Gemini first if API key is set, falls back to Ollama.
    Returns None if neither is available.
    """
    global _runner
    if _runner is not None:
        return _runner

    # Try Gemini first
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if gemini_key:
        try:
            from gemini_runner import GeminiRunner
            _runner = GeminiRunner()
            return _runner
        except Exception:
            pass

    # Fall back to Ollama
    try:
        from ollama_runner import OllamaRunner
        _runner = OllamaRunner()
        return _runner
    except Exception:
        pass

    return None
