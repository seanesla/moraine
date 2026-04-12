"""
FastAPI backend for Moraine GLOF calculator.
Wraps the existing Python modules (glof_core, runners, tile_manager) as REST/WebSocket endpoints.

Run in development:
    PYTHONPATH=. uvicorn backend.main:app --reload --port 8741
"""

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.routers import scenario, lakes, chat, tiles

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
app.include_router(tiles.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = 8741
    print(f"MORAINE_READY:{port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port)
