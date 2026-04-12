import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.dependencies import get_runner

router = APIRouter(tags=["chat"])


@router.websocket("/ws/chat")
async def chat_websocket(ws: WebSocket):
    """
    WebSocket endpoint for LLM chat.

    Client sends: {"message": "user text"}
    Server sends back a sequence of JSON messages:
      {"type": "thinking"}
      {"type": "tool_call", "name": "...", "arguments": {...}}
      {"type": "tool_result", "name": "...", "result": {...}}
      {"type": "response", "content": "final text"}
      {"type": "error", "message": "..."}
    """
    await ws.accept()

    runner = get_runner()
    if runner is None:
        await ws.send_json({"type": "error", "message": "No LLM backend available. Start Ollama or set GEMINI_API_KEY."})
        await ws.close()
        return

    try:
        while True:
            data = await ws.receive_json()
            user_message = data.get("message", "").strip()
            if not user_message:
                continue

            await ws.send_json({"type": "thinking"})

            # Run the synchronous runner.chat() in a thread to avoid blocking
            result = await asyncio.to_thread(runner.chat, user_message)

            if result.get("error"):
                await ws.send_json({"type": "error", "message": result["error"]})
                if result.get("response"):
                    await ws.send_json({"type": "response", "content": result["response"]})
                continue

            # Send tool calls if any
            for tc in result.get("tool_calls", []):
                await ws.send_json({
                    "type": "tool_call",
                    "name": tc["name"],
                    "arguments": tc["arguments"],
                })
                await ws.send_json({
                    "type": "tool_result",
                    "name": tc["name"],
                    "result": tc["result"],
                })

            # Send the final text response
            if result.get("response"):
                await ws.send_json({"type": "response", "content": result["response"]})

    except WebSocketDisconnect:
        pass
