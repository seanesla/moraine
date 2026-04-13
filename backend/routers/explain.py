"""
WebSocket endpoint: /ws/explain

Short-lived socket. One request → one streamed response (interpretation +
SMS alerts) → close.

Client → Server (single JSON message on open):
    {
      "scenario_hash": "sha256-hex-32-chars",
      "lake":   { name, name_nepali, country, region, lat, lon, elevation_m, volume_m3 },
      "params": { lake_volume_m3, valley_slope, channel_width_m, ... },
      "result": { discharge, flow_velocity_mps, wave_speed_mps, villages: [...] },
      "language": "en" | "ne" | "hi"
    }

Server → Client events (JSON):
    {"type": "cached",  "content": "<full markdown>"}           # cache hit; alerts follow
    {"type": "start",   "language": "en"}                        # stream is live
    {"type": "section", "name": "situation"}                     # ## heading crossed
    {"type": "delta",   "text": "partial token chunk"}           # main interpretation content
    {"type": "alert",   "village": "Dingboche", "sms": "..."}    # Phase 4 SMS alert draft
    {"type": "done"}                                             # terminal
    {"type": "error",   "message": "..."}                        # terminal

Flow (cold path):
  1. Receive JSON → resolve (hash, language)
  2. Cache miss → `start` event
  3. Run main interpretation stream (producer thread → asyncio.Queue)
     emitting `section` + `delta` events
  4. When main stream finishes, run alerts stream (second producer thread
     → same-shaped queue) emitting `alert` events as JSONL lines parse
  5. Cache {main text, alerts} under the same key
  6. Send `done` and close

Flow (cache hit):
  1. Receive JSON → resolve (hash, language)
  2. Cache hit → emit `cached` + one `alert` per cached entry + `done`

Implementation notes:
- The sync Ollama generator runs on a worker thread via `asyncio.to_thread`.
- Each streamed chunk is pushed onto an `asyncio.Queue` via
  `loop.call_soon_threadsafe(queue.put_nowait, ...)`.
- The main coroutine drains the queue and forwards events to the client.
- A sentinel (None) marks end-of-stream; an exception is pushed as `error`.
- Section detection: a regex against the accumulated text, tracking which
  section names have already been emitted so each fires once.
- Alert JSONL parsing: the alerts producer accumulates until `\n`, then
  attempts `json.loads`. Malformed lines are skipped silently so a single
  bad line never derails the stream.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.explain_cache import cache, compute_scenario_hash
from backend.explain_prompts import SUPPORTED_LANGS
from backend.interpretation_runner import get_stream_fn, stream_village_alerts


router = APIRouter(tags=["explain"])


# Match exact English h2 headings anywhere in the accumulated text.
# Case-insensitive + multiline so Gemma's streamed output (which may flow
# token-by-token) still resolves the same heading boundaries.
_SECTION_REGEX = re.compile(
    r"^##\s+(Situation|Village Impact|Evacuation Priorities|Historical Context|Confidence Notes)\s*$",
    re.MULTILINE | re.IGNORECASE,
)


# Mapping from the h2 heading as it appears in the text to the canonical
# event name the frontend expects.
_SECTION_EVENT_NAMES: dict[str, str] = {
    "situation": "situation",
    "village impact": "village_impact",
    "evacuation priorities": "evacuation_priorities",
    "historical context": "historical_context",
    "confidence notes": "confidence_notes",
}


@router.websocket("/ws/explain")
async def explain_websocket(ws: WebSocket) -> None:
    await ws.accept()

    try:
        payload = await ws.receive_json()
    except WebSocketDisconnect:
        return
    except Exception as exc:
        await _safe_send(ws, {"type": "error", "message": f"Bad request: {exc}"})
        await _safe_close(ws)
        return

    lake = payload.get("lake") or {}
    params = payload.get("params") or {}
    result = payload.get("result") or {}
    language = str(payload.get("language") or "en").lower()
    if language not in SUPPORTED_LANGS:
        language = "en"

    villages = list((result or {}).get("villages") or [])

    # Client may send a pre-computed hash (frontend mirror of the same
    # algorithm). The frontend hash is authoritative during the hackathon
    # demo (DA flagged a known algorithm mismatch between the frontend and
    # this file; cleanup is post-demo). Only fall back to the server hash
    # if the client payload is missing or clearly not hex.
    client_hash = str(payload.get("scenario_hash") or "")
    scenario_hash = client_hash if _looks_like_hash(client_hash) else compute_scenario_hash(
        lake, params, result
    )

    # ── Cache hit path ────────────────────────────────────────────────────
    cached_entry = cache.get_or_none(scenario_hash, language)
    if cached_entry is not None:
        # Replay the full package: cached main text + alerts + done.
        # Frontend code path stays symmetric between fresh and cached.
        await _safe_send(ws, {"type": "cached", "content": cached_entry.content})
        for village_name, sms_text in cached_entry.alerts:
            if not await _safe_send(
                ws,
                {"type": "alert", "village": village_name, "sms": sms_text},
            ):
                return  # client disconnected mid-replay
        await _safe_send(ws, {"type": "done"})
        await _safe_close(ws)
        return

    # ── Live stream path ──────────────────────────────────────────────────
    await _safe_send(ws, {"type": "start", "language": language})

    stream_fn = get_stream_fn()
    loop = asyncio.get_running_loop()

    # ── Phase 1: main interpretation stream ──────────────────────────────
    main_queue: asyncio.Queue[Any] = asyncio.Queue()

    def main_producer() -> None:
        """
        Sync generator → async queue bridge for the main interpretation.
        Runs on a worker thread. Pushes raw string chunks onto the queue;
        terminates with a `None` sentinel or pushes an Exception for the
        consumer to raise.
        """
        try:
            for chunk in stream_fn(lake, params, result, language):
                if not chunk:
                    continue
                loop.call_soon_threadsafe(main_queue.put_nowait, chunk)
        except Exception as exc:
            loop.call_soon_threadsafe(main_queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(main_queue.put_nowait, None)

    main_task = asyncio.create_task(asyncio.to_thread(main_producer))

    accumulated = ""
    emitted_sections: set[str] = set()
    client_disconnected = False
    main_stream_errored = False

    try:
        while True:
            item = await main_queue.get()
            if item is None:
                break

            if isinstance(item, Exception):
                main_stream_errored = True
                await _safe_send(
                    ws,
                    {"type": "error", "message": f"Gemma stream failed: {item}"},
                )
                # Drain the rest of the queue so the producer thread can exit cleanly.
                await _drain_remaining(main_queue)
                break

            chunk: str = item
            accumulated += chunk

            # Emit any newly-crossed section events before the delta so the
            # frontend can light up the indicator before the heading text
            # hits the markdown body.
            new_sections = _detect_new_sections(accumulated, emitted_sections)
            for section_name in new_sections:
                await _safe_send(ws, {"type": "section", "name": section_name})

            if not await _safe_send(ws, {"type": "delta", "text": chunk}):
                client_disconnected = True
                break
    finally:
        if not main_task.done():
            try:
                await main_task
            except Exception:
                pass

    if client_disconnected or main_stream_errored:
        # Don't try alerts if the main stream errored or the client is gone.
        if not client_disconnected:
            await _safe_close(ws)
        return

    # ── Phase 4: SMS alerts stream (second Gemma call) ───────────────────
    #
    # This is the proactive-agency moment: after the interpretation
    # finishes, we immediately kick off a second streaming call to draft
    # per-village SMS alerts. The prompt is different (JSONL output, no
    # markdown), the Gemma call is independent, and the frontend renders
    # the results as phone-message bubbles below the interpretation panel.
    alerts_captured: list[tuple[str, str]] = []

    if villages:
        alerts_captured = await _run_alerts_stream(
            ws=ws,
            lake=lake,
            villages=villages,
            language=language,
            loop=loop,
        )
        # If the client disconnected mid-alerts, `_run_alerts_stream`
        # returns whatever it captured; we still try to cache it so the
        # next click on the same scenario can replay fully.

    # ── Cache both main text + alerts under the same key ────────────────
    if accumulated:
        cache.put(scenario_hash, language, accumulated, alerts=alerts_captured)

    await _safe_send(ws, {"type": "done"})
    await _safe_close(ws)


# ── Phase 4 alerts stream helper ──────────────────────────────────────────


async def _run_alerts_stream(
    ws: WebSocket,
    lake: dict[str, Any],
    villages: list[dict[str, Any]],
    language: str,
    loop: asyncio.AbstractEventLoop,
) -> list[tuple[str, str]]:
    """
    Kick off the SMS-alerts streaming call on a worker thread and forward
    each parsed JSONL line to the WebSocket as an `alert` event. Returns
    the list of captured `(village, sms)` tuples so the caller can put
    them in the cache.

    JSONL parsing is done incrementally against an accumulating buffer.
    Complete lines (separated by `\n`) are handed to `json.loads`. A
    malformed line is skipped silently so one bad line can't derail the
    stream.

    If the alerts call itself raises, we swallow the error and return
    whatever we captured so the caller can still send `done` with the
    main interpretation intact. Alerts are a "nice to have" — a failure
    here should NOT take out the primary hero content.
    """
    alerts_queue: asyncio.Queue[Any] = asyncio.Queue()

    def alerts_producer() -> None:
        try:
            for chunk in stream_village_alerts(lake, villages, language):
                if not chunk:
                    continue
                loop.call_soon_threadsafe(alerts_queue.put_nowait, chunk)
        except Exception as exc:
            loop.call_soon_threadsafe(alerts_queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(alerts_queue.put_nowait, None)

    alerts_task = asyncio.create_task(asyncio.to_thread(alerts_producer))

    buffer = ""
    captured: list[tuple[str, str]] = []
    seen_villages: set[str] = set()

    try:
        while True:
            item = await alerts_queue.get()
            if item is None:
                break

            if isinstance(item, Exception):
                # Alerts failed — swallow and drain. The main interpretation
                # already made it to the client, which is the important thing.
                await _drain_remaining(alerts_queue)
                break

            chunk: str = item
            buffer += chunk

            # Parse any complete lines in the buffer.
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                parsed = _parse_alert_line(line)
                if parsed is None:
                    continue
                village_name, sms_text = parsed
                if village_name in seen_villages:
                    continue  # dedupe if the model repeats itself
                seen_villages.add(village_name)
                captured.append((village_name, sms_text))
                if not await _safe_send(
                    ws,
                    {"type": "alert", "village": village_name, "sms": sms_text},
                ):
                    await _drain_remaining(alerts_queue)
                    return captured
    finally:
        if not alerts_task.done():
            try:
                await alerts_task
            except Exception:
                pass

    # Flush any trailing line without a newline (models sometimes end
    # without a final \n).
    trailing = buffer.strip()
    if trailing:
        parsed = _parse_alert_line(trailing)
        if parsed is not None:
            village_name, sms_text = parsed
            if village_name not in seen_villages:
                captured.append((village_name, sms_text))
                await _safe_send(
                    ws,
                    {"type": "alert", "village": village_name, "sms": sms_text},
                )

    return captured


def _parse_alert_line(line: str) -> tuple[str, str] | None:
    """
    Parse a single JSONL alert line. Returns `(village, sms)` on success,
    None if the line is empty/malformed or missing required keys.

    Accepts a bit of sloppiness because small LLMs occasionally emit
    leading/trailing whitespace, commas, or surrounding markdown fences
    even when explicitly told not to.
    """
    stripped = line.strip()
    if not stripped:
        return None

    # Strip common wrappers the model might accidentally emit.
    if stripped.startswith("```"):
        return None
    # Trim a trailing comma after a JSON object (models sometimes think
    # it's a JSON array).
    if stripped.endswith(","):
        stripped = stripped[:-1].rstrip()

    # Look for the first `{` and last `}` in case there's leading noise.
    first = stripped.find("{")
    last = stripped.rfind("}")
    if first == -1 or last == -1 or last < first:
        return None

    candidate = stripped[first : last + 1]
    try:
        obj = json.loads(candidate)
    except json.JSONDecodeError:
        return None

    if not isinstance(obj, dict):
        return None

    village_name = obj.get("village")
    sms_text = obj.get("sms")
    if not isinstance(village_name, str) or not isinstance(sms_text, str):
        return None
    village_name = village_name.strip()
    sms_text = sms_text.strip()
    if not village_name or not sms_text:
        return None
    return village_name, sms_text


# ── Helpers ───────────────────────────────────────────────────────────────


def _looks_like_hash(value: str) -> bool:
    """Cheap sanity check so we don't treat garbage as a hash."""
    if not value or len(value) < 16 or len(value) > 64:
        return False
    try:
        int(value, 16)
    except ValueError:
        return False
    return True


def _detect_new_sections(accumulated: str, already_emitted: set[str]) -> list[str]:
    """
    Scan the accumulated streamed text for `## Section Name` headings and
    return the canonical event names for any not yet emitted. Mutates
    `already_emitted` in place so the caller doesn't need to.
    """
    new: list[str] = []
    for match in _SECTION_REGEX.finditer(accumulated):
        heading = match.group(1).strip().lower()
        event_name = _SECTION_EVENT_NAMES.get(heading)
        if event_name and event_name not in already_emitted:
            already_emitted.add(event_name)
            new.append(event_name)
    return new


async def _safe_send(ws: WebSocket, payload: dict[str, Any]) -> bool:
    """
    Send JSON if the socket is still open. Returns True on success, False if
    the client has disconnected so the caller can stop producing.
    """
    try:
        await ws.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False
    except Exception:
        return False


async def _safe_close(ws: WebSocket) -> None:
    try:
        await ws.close()
    except Exception:
        pass


async def _drain_remaining(queue: asyncio.Queue[Any]) -> None:
    """
    Pull everything off the queue until the sentinel so the producer thread
    that called `put_nowait` can finish cleanly. Used on error paths.
    """
    while True:
        try:
            item = queue.get_nowait()
        except asyncio.QueueEmpty:
            return
        if item is None:
            return
