import { create } from "zustand";
import type { ChatMessage, ToolCall } from "../types/chat";

interface ChatState {
  messages: ChatMessage[];
  isTyping: boolean;
  pendingToolCalls: ToolCall[];

  addUserMessage: (content: string) => string;
  addAssistantMessage: (content: string, toolCalls?: ToolCall[]) => void;
  setTyping: (typing: boolean) => void;
  addPendingToolCall: (tc: ToolCall) => void;
  clearPendingToolCalls: () => void;
  reset: () => void;
}

let messageId = 0;

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isTyping: false,
  pendingToolCalls: [],

  addUserMessage: (content) => {
    const id = `msg-${++messageId}`;
    set((state) => ({
      messages: [
        ...state.messages,
        { id, role: "user", content, timestamp: Date.now() },
      ],
    }));
    return id;
  },

  addAssistantMessage: (content, toolCalls) => {
    const id = `msg-${++messageId}`;
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          role: "assistant",
          content,
          toolCalls,
          timestamp: Date.now(),
        },
      ],
    }));
  },

  setTyping: (typing) => set({ isTyping: typing }),

  addPendingToolCall: (tc) =>
    set((state) => ({
      pendingToolCalls: [...state.pendingToolCalls, tc],
    })),

  clearPendingToolCalls: () => set({ pendingToolCalls: [] }),

  reset: () => set({ messages: [], isTyping: false, pendingToolCalls: [] }),
}));
