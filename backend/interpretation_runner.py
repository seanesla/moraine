"""
Stateless streaming wrapper around Ollama/Gemini for the Explain Panel.

This is intentionally separate from `ollama_runner.py` / `gemini_runner.py`
(the chat runners). Key differences:

1. STATELESS. Each call builds `[system, user]` from scratch. There is no
   persistent `self.messages`, no conversation history, no `reset()`.
2. NO TOOLS. Gemma has no tools in this path. The scenario has already been
   computed by `glof_core.compute_full_scenario()` and passed in as JSON.
   Gemma's only job is to narrate it.
3. NO TOOL LOOP. No max_rounds, no retries on tool failure — just a single
   streaming chat call, forwarding content chunks to the caller.

This file exposes SYNC generators. The async WebSocket router in
`backend/routers/explain.py` bridges them onto an asyncio queue via
`asyncio.to_thread` + `loop.call_soon_threadsafe`. The sync/async bridge
lives in the router, not here — this module stays dependency-light.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Iterator

from backend.explain_prompts import (
    INTERPRETATION_SYSTEM_PROMPT,
    build_alert_system_prompt,
    language_directive,
)


# Default model. Overridable via env so the hackathon demo can fall back to
# gemma3:4b if gemma4:e4b isn't pulled locally.
DEFAULT_MODEL = os.environ.get("GLOF_MODEL", "gemma4:e4b")


# ── User message builder ──────────────────────────────────────────────────


def build_user_message(
    lake: dict[str, Any],
    params: dict[str, Any],
    result: dict[str, Any],
    language: str,
) -> str:
    """
    Pack lake metadata + the already-computed scenario result + the language
    directive into a single user turn.

    We keep the JSON blob compact but not minified — Gemma handles pretty
    JSON better than it handles single-line blobs in practice.
    """
    lake_block = {
        "name": lake.get("name"),
        "name_nepali": lake.get("name_nepali"),
        "country": lake.get("country"),
        "region": lake.get("region"),
        "lat": lake.get("lat"),
        "lon": lake.get("lon"),
        "elevation_m": lake.get("elevation_m"),
        "volume_m3": lake.get("volume_m3"),
    }

    # Strip the big `parameters` dict from result if present — the frontend
    # sometimes echoes the params inside the result. We pass params separately.
    result_block = dict(result or {})
    result_block.pop("parameters", None)

    scenario_json = json.dumps(
        {
            "lake": lake_block,
            "parameters": params or {},
            "SCENARIO_RESULT": result_block,
        },
        indent=2,
        ensure_ascii=False,
        default=_json_default,
    )

    directive = language_directive(language)

    return (
        f"{directive}\n\n"
        "Here is the already-computed scenario you must narrate. Every figure "
        "you cite MUST come from this payload — you have no tools and no other "
        "data source.\n\n"
        f"{scenario_json}"
    )


# ── Ollama streaming ──────────────────────────────────────────────────────


def stream_ollama(
    lake: dict[str, Any],
    params: dict[str, Any],
    result: dict[str, Any],
    language: str,
    model: str | None = None,
) -> Iterator[str]:
    """
    Yield `chunk.message.content` strings from `ollama.chat(stream=True)`.

    This is a plain sync generator. The caller is responsible for running
    it in a thread (via `asyncio.to_thread` or similar) and bridging each
    chunk onto an async queue. The chunks are typically 1–10 tokens each.

    Raises any ollama client error to the caller — the router will wrap it
    into an `error` WebSocket event.
    """
    import ollama  # imported here so test harnesses can stub it

    model_name = model or DEFAULT_MODEL
    user_message = build_user_message(lake, params, result, language)

    messages = [
        {"role": "system", "content": INTERPRETATION_SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]

    try:
        stream = ollama.chat(
            model=model_name,
            messages=messages,
            stream=True,
        )
    except Exception as exc:
        # Fallback: try gemma3:4b if the primary model isn't pulled.
        if model_name != "gemma3:4b":
            try:
                stream = ollama.chat(
                    model="gemma3:4b",
                    messages=messages,
                    stream=True,
                )
            except Exception:
                raise exc
        else:
            raise

    for chunk in stream:
        # ollama>=0.3 exposes chunk.message.content; dict-like access also works.
        content: str | None = None
        msg = getattr(chunk, "message", None)
        if msg is not None:
            content = getattr(msg, "content", None)
            if content is None and isinstance(msg, dict):
                content = msg.get("content")
        elif isinstance(chunk, dict):
            content = (chunk.get("message") or {}).get("content")

        if content:
            yield content


# ── Gemini streaming (optional) ───────────────────────────────────────────


def stream_gemini(
    lake: dict[str, Any],
    params: dict[str, Any],
    result: dict[str, Any],
    language: str,
) -> Iterator[str]:
    """
    Gemini equivalent of `stream_ollama`. Only used if the GEMINI_API_KEY env
    var is set AND no local Ollama is reachable. Yields plain text chunks.

    Kept intentionally lightweight — the hackathon positioning is local-first
    via Ollama. Gemini is just a graceful fallback so the panel doesn't show
    dead air when a judge tries it on a machine without Ollama installed.
    """
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=api_key)

    user_message = build_user_message(lake, params, result, language)

    config = types.GenerateContentConfig(
        system_instruction=INTERPRETATION_SYSTEM_PROMPT,
        temperature=0.4,
    )

    # Model name chosen to match what the chat runner uses — if that file is
    # ever updated, this can be synced. Kept as a string literal rather than
    # importing from gemini_runner to avoid pulling its heavy deps.
    stream = client.models.generate_content_stream(
        model="gemini-2.5-flash",
        contents=user_message,
        config=config,
    )

    for chunk in stream:
        text = getattr(chunk, "text", None)
        if text:
            yield text


# ── Phase 4: SMS alert drafts ─────────────────────────────────────────────
#
# These helpers power the PROACTIVE AGENCY moment. After the main
# interpretation finishes streaming, the router kicks off a SECOND
# streaming call with `stream_village_alerts(...)` to draft per-village
# SMS text. That second call uses a different system prompt
# (`ALERT_SYSTEM_PROMPT_TEMPLATE`) and expects the model to emit one JSON
# line per village. The router parses JSONL incrementally and emits
# `alert` events to the WebSocket client as each line arrives.
#
# This is NOT a tool call. The runner stays stateless and tool-free.


def build_alert_user_message(
    lake: dict[str, Any],
    villages: list[dict[str, Any]],
    language: str,
) -> str:
    """
    Pack the lake name + village list (name, arrival_time_min, severity)
    into a plain text user turn for the SMS alerts call.

    Villages are defensively re-sorted by arrival time here so the Gemma
    call reliably produces alerts most-urgent-first even if the incoming
    payload was ever reordered upstream. `glof_core.compute_full_scenario`
    already sorts by `arrival_time_min`, so in practice this is a no-op,
    but we can't guarantee every future caller will preserve that order.
    """
    directive = language_directive(language)

    sorted_villages = sorted(
        villages or [],
        key=lambda v: (
            v.get("arrival_time_min") if v.get("arrival_time_min") is not None else float("inf")
        ),
    )

    # Compact per-village lines the model can easily echo back.
    lines: list[str] = []
    for v in sorted_villages:
        name = str(v.get("name") or "").strip()
        if not name:
            continue
        arrival = v.get("arrival_time_min")
        severity = str(v.get("severity") or "").strip() or "UNKNOWN"
        arrival_text = (
            f"{float(arrival):.1f} min"
            if isinstance(arrival, (int, float))
            else "unknown"
        )
        nep = str(v.get("name_nepali") or "").strip()
        if nep:
            lines.append(
                f"- {name} ({nep}): arrives in {arrival_text}, severity {severity}"
            )
        else:
            lines.append(f"- {name}: arrives in {arrival_text}, severity {severity}")

    villages_block = "\n".join(lines) if lines else "- (no villages in scenario)"

    lake_name = str(lake.get("name") or "the glacial lake").strip() or "the glacial lake"

    return (
        f"{directive}\n\n"
        f"Lake: {lake_name}\n"
        "Hazard: glacial lake outburst flood (GLOF)\n\n"
        "Villages (ordered by arrival time, most urgent first):\n"
        f"{villages_block}\n\n"
        "Produce one JSON line per village, in the same order, with fields "
        "\"village\" and \"sms\". Each SMS must be ≤160 characters including "
        "spaces and punctuation. Write the SMS body in the requested language. "
        "No markdown, no commentary, JSON lines only."
    )


def stream_village_alerts(
    lake: dict[str, Any],
    villages: list[dict[str, Any]],
    language: str,
    model: str | None = None,
) -> Iterator[str]:
    """
    Yield text chunks from a streaming Gemma call drafting per-village SMS
    alerts. Delegates to the same Ollama/Gemini picker as the main
    interpretation call — whichever backend is active for that process
    will produce the alerts.

    The chunks are raw text tokens (not parsed JSON). The router is
    responsible for accumulating them into newline-separated JSON lines
    and parsing each `{"village": ..., "sms": ...}` object.

    Sync generator. Caller must bridge to async via `asyncio.to_thread`.
    """
    # We dispatch through `get_stream_fn()` to reuse Ollama-vs-Gemini
    # selection logic, but the two engine-specific functions below read the
    # PROMPT from a different constant, so we implement the call inline
    # here rather than routing through `stream_ollama` (which hard-codes
    # INTERPRETATION_SYSTEM_PROMPT).
    #
    # Decision: try Ollama first, fall back to Gemini if Ollama raises,
    # mirroring `get_stream_fn()`'s preference.

    system_prompt = build_alert_system_prompt(language)
    user_message = build_alert_user_message(lake, villages, language)

    # Try Ollama first
    try:
        import ollama  # noqa: F401

        yield from _stream_alerts_ollama(
            system_prompt=system_prompt,
            user_message=user_message,
            model=model,
        )
        return
    except Exception as ollama_exc:
        # Fall through to Gemini if configured, otherwise re-raise.
        if os.environ.get("GEMINI_API_KEY", "").strip():
            try:
                yield from _stream_alerts_gemini(
                    system_prompt=system_prompt,
                    user_message=user_message,
                )
                return
            except Exception:
                pass
        raise ollama_exc


def _stream_alerts_ollama(
    system_prompt: str,
    user_message: str,
    model: str | None = None,
) -> Iterator[str]:
    """Ollama backend for the alerts call. Single-purpose, stateless."""
    import ollama

    model_name = model or DEFAULT_MODEL

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    try:
        stream = ollama.chat(
            model=model_name,
            messages=messages,
            stream=True,
        )
    except Exception as exc:
        # Fallback to gemma3:4b if the primary model isn't pulled locally.
        if model_name != "gemma3:4b":
            try:
                stream = ollama.chat(
                    model="gemma3:4b",
                    messages=messages,
                    stream=True,
                )
            except Exception:
                raise exc
        else:
            raise

    for chunk in stream:
        content: str | None = None
        msg = getattr(chunk, "message", None)
        if msg is not None:
            content = getattr(msg, "content", None)
            if content is None and isinstance(msg, dict):
                content = msg.get("content")
        elif isinstance(chunk, dict):
            content = (chunk.get("message") or {}).get("content")
        if content:
            yield content


def _stream_alerts_gemini(system_prompt: str, user_message: str) -> Iterator[str]:
    """Gemini fallback for the alerts call. Same shape as `_stream_alerts_ollama`."""
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=api_key)
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        temperature=0.3,
    )
    stream = client.models.generate_content_stream(
        model="gemini-2.5-flash",
        contents=user_message,
        config=config,
    )
    for chunk in stream:
        text = getattr(chunk, "text", None)
        if text:
            yield text


# ── Backend picker ────────────────────────────────────────────────────────


StreamFn = Callable[
    [dict[str, Any], dict[str, Any], dict[str, Any], str],
    Iterator[str],
]


def get_stream_fn() -> StreamFn:
    """
    Pick a streaming function based on what's available. Ollama is preferred
    (local-first positioning); Gemini is the fallback.

    We do NOT reach into `backend.dependencies.get_runner()` — that singleton
    is the STATEFUL chat runner and must stay untouched per the plan.
    """
    # Prefer Ollama: if the client import succeeds and the daemon is up, use it.
    try:
        import ollama  # noqa: F401

        # Cheap ping: list models. If the daemon is down this will raise.
        ollama.list()
        return stream_ollama
    except Exception:
        pass

    # Gemini fallback
    if os.environ.get("GEMINI_API_KEY", "").strip():
        try:
            from google import genai  # noqa: F401

            return stream_gemini
        except Exception:
            pass

    # Last resort: return stream_ollama and let it fail with a useful error
    # inside the router (which becomes a proper websocket `error` event).
    return stream_ollama


# ── Internal helpers ──────────────────────────────────────────────────────


def _json_default(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        try:
            return obj.model_dump()
        except Exception:
            pass
    if hasattr(obj, "dict"):
        try:
            return obj.dict()
        except Exception:
            pass
    return str(obj)
