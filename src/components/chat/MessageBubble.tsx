import { User, Bot } from "lucide-react";
import type { ChatMessage } from "../../types/chat";

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-3 px-4 py-3 animate-fade-in-up ${
        isUser ? "flex-row-reverse" : ""
      }`}
      style={{ animationDuration: "0.3s" }}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isUser
            ? "bg-accent-blue/15 text-accent-blue"
            : "bg-accent-cyan/15 text-accent-cyan"
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-accent-blue/10 border border-accent-blue/15 text-text-primary rounded-tr-sm"
            : "bg-bg-tertiary/60 border border-border text-text-primary rounded-tl-sm"
        }`}
      >
        {/* Tool calls summary */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 pb-2 border-b border-border">
            {message.toolCalls.map((tc, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 text-[11px] text-accent-cyan"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
                Used tool: {tc.name}
              </div>
            ))}
          </div>
        )}

        {/* Message content - simple whitespace preservation */}
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}
