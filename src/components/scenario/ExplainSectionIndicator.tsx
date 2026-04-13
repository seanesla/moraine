import {
  INTERPRETATION_SECTIONS,
  SECTION_LABELS,
  type InterpretationSection,
} from "../../types/interpretation";

interface ExplainSectionIndicatorProps {
  currentSection: InterpretationSection | null;
  completedSections: InterpretationSection[];
}

/**
 * A 5-dot horizontal row. For each of the interpretation sections:
 *   - empty (grey ring)    — not yet reached
 *   - active (cyan, glow)  — currently streaming
 *   - done   (filled white)— already completed
 *
 * Keeps the user oriented while the markdown body is still streaming in.
 */
export default function ExplainSectionIndicator({
  currentSection,
  completedSections,
}: ExplainSectionIndicatorProps) {
  const completedSet = new Set(completedSections);

  return (
    <div className="flex items-center justify-between gap-2 w-full">
      {INTERPRETATION_SECTIONS.map((section, i) => {
        const isCurrent = section === currentSection;
        const isDone = completedSet.has(section) && !isCurrent;
        const dotClass = isDone
          ? "bg-white border-white"
          : isCurrent
            ? "bg-accent-cyan border-accent-cyan shadow-[0_0_8px_rgba(0,212,255,0.7)]"
            : "bg-transparent border-border";
        const labelClass = isDone
          ? "text-text-primary"
          : isCurrent
            ? "text-accent-cyan"
            : "text-text-muted";

        return (
          <div
            key={section}
            className="flex items-center flex-1 min-w-0"
          >
            <div className="flex flex-col items-center gap-1 min-w-0">
              <span
                className={`w-2.5 h-2.5 rounded-full border transition-all duration-300 ${dotClass}`}
                aria-hidden
              />
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider truncate ${labelClass}`}
              >
                {SECTION_LABELS[section]}
              </span>
            </div>
            {i < INTERPRETATION_SECTIONS.length - 1 && (
              <span
                className={`flex-1 h-px mx-2 transition-colors duration-300 ${
                  isDone ? "bg-white/40" : "bg-border"
                }`}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
