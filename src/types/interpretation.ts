export type InterpretationLanguage = "en" | "ne" | "hi";

export const INTERPRETATION_LANGUAGES: InterpretationLanguage[] = [
  "en",
  "ne",
  "hi",
];

export const LANGUAGE_LABELS: Record<InterpretationLanguage, string> = {
  en: "EN",
  ne: "नेपाली",
  hi: "हिन्दी",
};

/**
 * The five ## headings the backend prompt forces Gemma to emit (in English),
 * even when the body of the interpretation is in Nepali or Hindi. The frontend
 * anchors its section indicator row to these exact names.
 */
export type InterpretationSection =
  | "situation"
  | "village_impact"
  | "evacuation_priorities"
  | "historical_context"
  | "confidence_notes";

export const INTERPRETATION_SECTIONS: InterpretationSection[] = [
  "situation",
  "village_impact",
  "evacuation_priorities",
  "historical_context",
  "confidence_notes",
];

export const SECTION_LABELS: Record<InterpretationSection, string> = {
  situation: "Situation",
  village_impact: "Village Impact",
  evacuation_priorities: "Evacuation",
  historical_context: "Historical",
  confidence_notes: "Confidence",
};

export type InterpretationStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "done"
  | "error";

export interface InterpretationState {
  status: InterpretationStatus;
  /** Full rolling markdown body — grows via appendDelta, or is set once via setFull (cached). */
  content: string;
  /** Error message, only populated when status === "error". */
  error: string | null;
  /** Most recently started section — null until the first section event arrives. */
  currentSection: InterpretationSection | null;
  /** Sections whose bodies have finished streaming (or were present in a cached load). */
  completedSections: InterpretationSection[];
  /** Epoch ms when the request opened the socket. */
  startedAt: number | null;
  /** Epoch ms when the first delta token arrived. null while waiting for Gemma's first chunk. */
  firstTokenAt: number | null;
  /** Epoch ms when the `done` event arrived. */
  finishedAt: number | null;
  /** Draft SMS alerts keyed by village name, populated by Phase 4's alert events. */
  alerts: Record<string, string>;
}

export function createEmptyInterpretationState(): InterpretationState {
  return {
    status: "idle",
    content: "",
    error: null,
    currentSection: null,
    completedSections: [],
    startedAt: null,
    firstTokenAt: null,
    finishedAt: null,
    alerts: {},
  };
}
