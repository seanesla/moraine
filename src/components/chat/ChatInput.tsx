import { useState, useRef } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t border-border bg-bg-secondary/60">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a scenario or ask about a glacial lake..."
            rows={1}
            className="w-full bg-bg-primary border border-border rounded-xl px-4 py-3 pr-12 text-sm text-text-primary placeholder:text-text-muted resize-none outline-none focus:border-accent-cyan/30 transition-colors"
            style={{ minHeight: 44, maxHeight: 120 }}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className="w-10 h-10 rounded-xl bg-accent-cyan/15 text-accent-cyan flex items-center justify-center hover:bg-accent-cyan/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
