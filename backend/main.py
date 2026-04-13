"""
FastAPI backend for Moraine GLOF calculator.
Wraps the existing Python modules (glof_core, gemini_runner/ollama_runner) as REST/WebSocket endpoints.

Run in development:
    PYTHONPATH=. uvicorn backend.main:app --reload --port 8741
"""

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.routers import scenario, lakes, chat, packs, explain

app = FastAPI(
    title="Moraine API",
    description="GLOF Downstream Arrival Time Calculator",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",   # Vite dev server
        "tauri://localhost",       # Tauri production webview
        "https://tauri.localhost", # Tauri v2 webview
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scenario.router)
app.include_router(lakes.router)
app.include_router(chat.router)
app.include_router(packs.router)
app.include_router(explain.router)


@app.on_event("startup")
async def warm_gemma_on_startup() -> None:
    """
    Pre-pull the Gemma model into memory so the first real click on
    "Explain these results" doesn't hit Ollama's 10–20 second cold start.

    We stream a dummy payload and discard after the first token. Any
    failure is swallowed — the warm-up is a nicety, not a requirement.
    The backend should still start even if Ollama is down.
    """
    import asyncio

    def _warmup_sync() -> None:
        try:
            from backend.interpretation_runner import stream_ollama

            gen = stream_ollama(
                lake={"name": "warmup", "volume_m3": 1},
                params={},
                result={"villages": [], "discharge": {"average_m3s": 0}, "wave_speed_mps": 0},
                language="en",
            )
            for _ in gen:
                break
        except Exception:
            pass

    try:
        # Run the warmup in a thread so we don't block the FastAPI lifespan.
        asyncio.create_task(asyncio.to_thread(_warmup_sync))
    except Exception:
        pass

# ── Self-hosted pack registry (Phase 4) ───────────────────────────────────
#
# The remote-update flow needs an HTTP-accessible registry. For the
# hackathon demo we serve <project_root>/docs/packs/ from this same
# FastAPI process at /registry/, so the whole update story works end
# to end with zero external infrastructure (no GitHub Pages, no S3).
# For real deployment, override MORAINE_PACK_REGISTRY_URL via env var
# to point at a CDN.
_REGISTRY_DIR = Path(__file__).parent.parent / "docs" / "packs"
if _REGISTRY_DIR.is_dir():
    app.mount(
        "/registry",
        StaticFiles(directory=str(_REGISTRY_DIR)),
        name="registry",
    )


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = 8741
    print(f"MORAINE_READY:{port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port)
