"""
Backend configuration constants for Moraine.

Values can be overridden via environment variables (loaded from .env by
backend/main.py via python-dotenv).
"""

from __future__ import annotations

import os

# ── Phase 4: Pack registry ────────────────────────────────────────────────
#
# URL of the remote pack registry index.json. Used by the "Check for
# updates" flow in the Region Manager UI.
#
# DEFAULT (development): the FastAPI backend serves the contents of
# `<project_root>/docs/packs/` as static files at /registry/, so the
# registry is fully self-contained — no external dependencies, no
# GitHub Pages setup required for the demo to work end-to-end.
#
# PRODUCTION: override via env var to point at a real CDN, e.g.
# `https://<owner>.github.io/moraine/packs/index.json` if the registry
# is hosted on GitHub Pages from the moraine repo's `/docs` directory.
PACK_REGISTRY_URL: str = os.environ.get(
    "MORAINE_PACK_REGISTRY_URL",
    "http://127.0.0.1:8741/registry/index.json",
).strip()

# Timeout (seconds) for any HTTP request the update flow makes.
PACK_REGISTRY_HTTP_TIMEOUT: float = float(
    os.environ.get("MORAINE_PACK_REGISTRY_TIMEOUT", "10")
)
