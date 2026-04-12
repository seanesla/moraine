import { Zap } from "lucide-react";

interface SuggestionChipsProps {
  onSelect: (text: string) => void;
}

const suggestions = [
  "Imja Tsho just burst. How long until the flood reaches Namche Bazaar?",
  "Generate an evacuation plan for villages near Tsho Rolpa.",
  "What would happen if Lower Barun lake breached during monsoon?",
];

export default function SuggestionChips({ onSelect }: SuggestionChipsProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 gap-6">
      <div className="text-center">
        <div className="w-12 h-12 rounded-2xl bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center mx-auto mb-4">
          <Zap className="w-6 h-6 text-accent-cyan" />
        </div>
        <h2 className="text-xl font-bold text-text-primary mb-1">
          Ask about GLOFs
        </h2>
        <p className="text-sm text-text-muted max-w-md">
          Chat with the AI about glacial lake risks, evacuation plans, or
          run scenarios through natural language.
        </p>
      </div>

      <div className="flex flex-col gap-2 max-w-lg w-full">
        {suggestions.map((text, i) => (
          <button
            key={i}
            onClick={() => onSelect(text)}
            className="text-left px-4 py-3 rounded-xl border border-border bg-bg-tertiary/30 text-sm text-text-secondary hover:text-text-primary hover:border-accent-cyan/20 hover:bg-accent-cyan/[0.03] transition-all duration-200 cursor-pointer animate-fade-in-up"
            style={{ animationDelay: `${i * 0.1}s` }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
