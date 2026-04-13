import { create } from "zustand";
import {
  createEmptyInterpretationState,
  INTERPRETATION_SECTIONS,
  type InterpretationLanguage,
  type InterpretationSection,
  type InterpretationState,
} from "../types/interpretation";

/**
 * Per-(scenarioHash, language) cache slot. Clicking one language chip MUST NOT
 * clear the cache for another language — each slot is independent so flipping
 * between EN / NE / HI after they're each cached is a pure client-side lookup.
 */
type LanguageSlotMap = Partial<Record<InterpretationLanguage, InterpretationState>>;

interface InterpretationStore {
  /** Keyed by { [scenarioHash]: { [language]: state } }. */
  byHash: Record<string, LanguageSlotMap>;
  /**
   * Currently selected language chip per (scenarioHash). Persisted here rather
   * than on each slot so the active chip survives regeneration.
   */
  activeLanguageByHash: Record<string, InterpretationLanguage>;

  // Reads
  get: (hash: string, lang: InterpretationLanguage) => InterpretationState | undefined;
  getActiveLanguage: (hash: string) => InterpretationLanguage;

  // Mutations — all are keyed by (hash, lang) to keep slots isolated.
  init: (hash: string, lang: InterpretationLanguage) => void;
  appendDelta: (hash: string, lang: InterpretationLanguage, text: string) => void;
  noteSection: (
    hash: string,
    lang: InterpretationLanguage,
    section: InterpretationSection,
  ) => void;
  finish: (hash: string, lang: InterpretationLanguage) => void;
  setFull: (hash: string, lang: InterpretationLanguage, content: string) => void;
  setError: (hash: string, lang: InterpretationLanguage, message: string) => void;
  appendAlert: (
    hash: string,
    lang: InterpretationLanguage,
    village: string,
    sms: string,
  ) => void;
  setActiveLanguage: (hash: string, lang: InterpretationLanguage) => void;
  reset: (hash: string, lang?: InterpretationLanguage) => void;
}

/**
 * Small helper — returns the existing slot map for a hash, or an empty one.
 * Never mutates the stored object (we always spread into a fresh object for
 * Zustand's shallow equality).
 */
function slotMap(byHash: Record<string, LanguageSlotMap>, hash: string): LanguageSlotMap {
  return byHash[hash] ?? {};
}

function existing(
  byHash: Record<string, LanguageSlotMap>,
  hash: string,
  lang: InterpretationLanguage,
): InterpretationState {
  return slotMap(byHash, hash)[lang] ?? createEmptyInterpretationState();
}

export const useInterpretationStore = create<InterpretationStore>((set, get) => ({
  byHash: {},
  activeLanguageByHash: {},

  get: (hash, lang) => get().byHash[hash]?.[lang],

  getActiveLanguage: (hash) => get().activeLanguageByHash[hash] ?? "en",

  init: (hash, lang) =>
    set((state) => {
      const now = Date.now();
      const fresh: InterpretationState = {
        ...createEmptyInterpretationState(),
        status: "connecting",
        startedAt: now,
      };
      return {
        byHash: {
          ...state.byHash,
          [hash]: { ...slotMap(state.byHash, hash), [lang]: fresh },
        },
      };
    }),

  appendDelta: (hash, lang, text) =>
    set((state) => {
      const prev = existing(state.byHash, hash, lang);
      const updated: InterpretationState = {
        ...prev,
        status: "streaming",
        content: prev.content + text,
        firstTokenAt: prev.firstTokenAt ?? Date.now(),
      };
      return {
        byHash: {
          ...state.byHash,
          [hash]: { ...slotMap(state.byHash, hash), [lang]: updated },
        },
      };
    }),

  noteSection: (hash, lang, section) =>
    set((state) => {
      const prev = existing(state.byHash, hash, lang);
      // The previously-active section is the one just completed (if any).
      const completed: InterpretationSection[] =
        prev.currentSection && !prev.completedSections.includes(prev.currentSection)
          ? [...prev.completedSections, prev.currentSection]
          : prev.completedSections;
      const updated: InterpretationState = {
        ...prev,
        currentSection: section,
        completedSections: completed,
      };
      return {
        byHash: {
          ...state.byHash,
          [hash]: { ...slotMap(state.byHash, hash), [lang]: updated },
        },
      };
    }),

  finish: (hash, lang) =>
    set((state) => {
      const prev = existing(state.byHash, hash, lang);
      // Flush the current section into completedSections if it hasn't been already,
      // then mark every section as complete so the indicator row fills fully.
      const completed = Array.from(
        new Set<InterpretationSection>([
          ...prev.completedSections,
          ...(prev.currentSection ? [prev.currentSection] : []),
          ...INTERPRETATION_SECTIONS,
        ]),
      );
      const updated: InterpretationState = {
        ...prev,
        status: "done",
        completedSections: completed,
        finishedAt: Date.now(),
      };
      return {
        byHash: {
          ...state.byHash,
          [hash]: { ...slotMap(state.byHash, hash), [lang]: updated },
        },
      };
    }),

  setFull: (hash, lang, content) =>
    set((state) => {
      const now = Date.now();
      const updated: InterpretationState = {
        ...createEmptyInterpretationState(),
        status: "done",
        content,
        startedAt: now,
        firstTokenAt: now,
        finishedAt: now,
        completedSections: [...INTERPRETATION_SECTIONS],
      };
      return {
        byHash: {
          ...state.byHash,
          [hash]: { ...slotMap(state.byHash, hash), [lang]: updated },
        },
      };
    }),

  setError: (hash, lang, message) =>
    set((state) => {
      const prev = existing(state.byHash, hash, lang);
      const updated: InterpretationState = {
        ...prev,
        status: "error",
        error: message,
      };
      return {
        byHash: {
          ...state.byHash,
          [hash]: { ...slotMap(state.byHash, hash), [lang]: updated },
        },
      };
    }),

  appendAlert: (hash, lang, village, sms) =>
    set((state) => {
      const prev = existing(state.byHash, hash, lang);
      const updated: InterpretationState = {
        ...prev,
        alerts: { ...prev.alerts, [village]: sms },
      };
      return {
        byHash: {
          ...state.byHash,
          [hash]: { ...slotMap(state.byHash, hash), [lang]: updated },
        },
      };
    }),

  setActiveLanguage: (hash, lang) =>
    set((state) => ({
      activeLanguageByHash: { ...state.activeLanguageByHash, [hash]: lang },
    })),

  reset: (hash, lang) =>
    set((state) => {
      if (!lang) {
        const { [hash]: _omit, ...restByHash } = state.byHash;
        const { [hash]: _omitLang, ...restActive } = state.activeLanguageByHash;
        return { byHash: restByHash, activeLanguageByHash: restActive };
      }
      const map = { ...slotMap(state.byHash, hash) };
      delete map[lang];
      return {
        byHash: { ...state.byHash, [hash]: map },
      };
    }),
}));
