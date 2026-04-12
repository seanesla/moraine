import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "../stores/chatStore";
import { createWebSocket } from "../lib/api";
import type { ToolCall } from "../types/chat";

export function useChat() {
  const wsRef = useRef<WebSocket | null>(null);
  const {
    messages,
    isTyping,
    addUserMessage,
    addAssistantMessage,
    setTyping,
    addPendingToolCall,
    clearPendingToolCalls,
  } = useChatStore();

  // Connect WebSocket on mount
  useEffect(() => {
    const ws = createWebSocket("/ws/chat");
    wsRef.current = ws;

    const toolCalls: ToolCall[] = [];

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "thinking":
          setTyping(true);
          break;

        case "tool_call":
          addPendingToolCall({
            name: data.name,
            arguments: data.arguments,
            result: {},
          });
          break;

        case "tool_result":
          toolCalls.push({
            name: data.name,
            arguments: {},
            result: data.result,
          });
          break;

        case "response":
          setTyping(false);
          clearPendingToolCalls();
          addAssistantMessage(
            data.content,
            toolCalls.length > 0 ? [...toolCalls] : undefined
          );
          toolCalls.length = 0;
          break;

        case "error":
          setTyping(false);
          clearPendingToolCalls();
          addAssistantMessage(`Error: ${data.message}`);
          toolCalls.length = 0;
          break;
      }
    };

    ws.onerror = () => {
      setTyping(false);
    };

    return () => {
      ws.close();
    };
  }, [addAssistantMessage, addPendingToolCall, clearPendingToolCalls, setTyping]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || !wsRef.current) return;
      addUserMessage(text);
      wsRef.current.send(JSON.stringify({ message: text }));
    },
    [addUserMessage]
  );

  return { messages, isTyping, sendMessage };
}
