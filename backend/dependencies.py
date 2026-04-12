import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Add the project root to sys.path so we can import glof_core, runners, etc.
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

load_dotenv(PROJECT_ROOT / ".env")

# Lazy-loaded singletons
_lakes_db: list[dict] | None = None
_runner = None


def get_lakes_db() -> list[dict]:
    """Load the lake database from data/lakes.json. Cached after first call."""
    global _lakes_db
    if _lakes_db is None:
        lakes_path = PROJECT_ROOT / "data" / "lakes.json"
        with open(lakes_path) as f:
            data = json.load(f)
        _lakes_db = data["lakes"]
    return _lakes_db


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
