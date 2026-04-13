"""
In-memory LRU cache for Gemma-generated interpretation text.

Goals:
- When the user clicks "Explain these results" twice in a row for the same
  scenario + language, we should short-circuit with a `cached` event instead
  of paying another 5–15s stream.
- The cache key is a deterministic SHA-256 hash of the load-bearing parts of
  the scenario (lake identity + parameters + computed numbers that drive the
  narrative). Cosmetic fields (colors, frontend rendering flags) are excluded.
- In-process only. Clears on backend restart. That's acceptable for a demo.

The LRU is backed by `collections.OrderedDict` with a `threading.Lock` so the
cache is safe to read/write from both the WebSocket coroutine and the
thread running the sync Ollama generator.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from typing import Any


# Max number of (hash, lang) entries kept in memory. Chosen so a demo can
# cycle through 10 lakes × 3 languages without evicting anything.
_MAX_ENTRIES = 32


class CachedInterpretation:
    """
    Value stored in the interpretation cache.

    Contains the full Markdown body produced by the main interpretation
    stream AND the list of per-village SMS alerts produced by the Phase 4
    alerts stream. Both sides are stored together under the same (hash,
    language) key so a cached replay can reproduce the full frontend
    experience — main text plus alert bubbles — without re-invoking Gemma.

    `alerts` is a list of `(village_name, sms_text)` tuples preserving the
    order the model emitted them (which the prompt requires to be
    most-urgent-first). A list-of-tuples is used instead of a dict so the
    order is stable across Python versions and so the cache can hold
    duplicate village names without silently dropping.
    """

    __slots__ = ("content", "alerts")

    def __init__(self, content: str, alerts: list[tuple[str, str]] | None = None) -> None:
        self.content = content
        self.alerts: list[tuple[str, str]] = list(alerts or [])


class _InterpretationCache:
    """Thread-safe LRU for interpretation markdown + SMS alert drafts."""

    def __init__(self, max_entries: int = _MAX_ENTRIES) -> None:
        self._max = max_entries
        self._data: "OrderedDict[tuple[str, str], CachedInterpretation]" = OrderedDict()
        self._lock = threading.Lock()

    def get_or_none(
        self, scenario_hash: str, language: str
    ) -> CachedInterpretation | None:
        """
        Return the cached package or None. Marks the entry as
        most-recently-used on a hit so the LRU ordering stays honest.
        """
        key = (scenario_hash, language)
        with self._lock:
            if key not in self._data:
                return None
            self._data.move_to_end(key)
            return self._data[key]

    def put(
        self,
        scenario_hash: str,
        language: str,
        content: str,
        alerts: list[tuple[str, str]] | None = None,
    ) -> None:
        """
        Store a freshly-streamed interpretation (and any SMS alerts) and
        evict the oldest entry if we're full.
        """
        key = (scenario_hash, language)
        entry = CachedInterpretation(content=content, alerts=alerts)
        with self._lock:
            self._data[key] = entry
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def clear(self) -> None:
        """Wipe everything. Only used by tests and manual admin calls."""
        with self._lock:
            self._data.clear()


# Module-level singleton. Import `cache` and call `cache.get_or_none(...)` /
# `cache.put(...)` from the router.
cache = _InterpretationCache()


def compute_scenario_hash(
    lake: dict[str, Any],
    params: dict[str, Any],
    result: dict[str, Any],
) -> str:
    """
    Deterministic 32-char hex digest over the load-bearing parts of a
    scenario. Same scenario → same hash → cache hit.

    Inputs are passed as plain dicts (the router has already parsed them
    from JSON so Pydantic models aren't required here).

    Fields hashed:
      lake_id           : lake identity (if the same lake is reused we want a hit)
      sorted_params     : canonical parameter dump (sort_keys=True)
      discharge_avg     : computed average discharge (drives the narrative)
      wave_speed_mps    : computed wave speed (drives the narrative)
      villages          : per-village name/arrival/severity triples, sorted
                          by name for determinism so arbitrary list order
                          from the frontend can't bust the cache

    Returns: first 32 hex chars of SHA-256 (same length as the frontend mirror).
    """
    lake_id = str(lake.get("id") or lake.get("name") or "")

    # Canonical parameter dump — sort_keys=True so key order doesn't matter.
    params_json = json.dumps(params or {}, sort_keys=True, default=_json_default)

    discharge = (result or {}).get("discharge", {}) or {}
    discharge_avg = discharge.get("average_m3s") or discharge.get("average") or 0.0

    wave_speed = (result or {}).get("wave_speed_mps") or 0.0

    village_tuples: list[tuple[str, float, str]] = []
    for v in (result or {}).get("villages", []) or []:
        name = str(v.get("name") or "")
        arrival = float(v.get("arrival_time_min") or 0.0)
        severity = str(v.get("severity") or "")
        village_tuples.append((name, arrival, severity))
    # Sort by name so frontend list order doesn't change the hash.
    village_tuples.sort(key=lambda t: t[0])

    payload = {
        "lake_id": lake_id,
        "params": params_json,
        "discharge_avg": _round(discharge_avg),
        "wave_speed": _round(wave_speed),
        "villages": village_tuples,
    }
    blob = json.dumps(payload, sort_keys=True, default=_json_default)
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()
    return digest[:32]


def _round(value: Any) -> float:
    """
    Round floats to 4 decimal places before hashing so microscopic numeric
    drift (e.g. 1234.56789999 vs 1234.56790001) doesn't break cache hits.
    """
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return 0.0


def _json_default(obj: Any) -> Any:
    """Best-effort JSON fallback for unusual types."""
    if hasattr(obj, "dict"):
        try:
            return obj.dict()  # pydantic v1
        except Exception:
            pass
    if hasattr(obj, "model_dump"):
        try:
            return obj.model_dump()  # pydantic v2
        except Exception:
            pass
    return str(obj)
