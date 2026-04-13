import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Bot, RefreshCw, Sparkles } from "lucide-react";
import {
  INTERPRETATION_LANGUAGES,
  LANGUAGE_LABELS,
  type InterpretationLanguage,
  type InterpretationState,
} from "../../types/interpretation";
import { useInterpretationStore } from "../../stores/interpretationStore";
import { useExplainStream } from "../../hooks/useExplainStream";
import { useScenarioStore } from "../../stores/scenarioStore";
import { computeScenarioHash } from "../../lib/scenarioHash";
import type { Lake } from "../../types/lake";
import type { ScenarioResult } from "../../types/scenario";
import ExplainSectionIndicator from "./ExplainSectionIndicator";
import AlertBubbles from "./AlertBubbles";

interface ExplainPanelProps {
  result: ScenarioResult;
  lake: Lake;
}

/**
 * One-click button that streams a plain-English (or Nepali / Hindi)
 * interpretation of a scenario from a local Gemma 4 model. Four visual states:
 *   1. idle      — pill button with Sparkles icon
 *   2. streaming — expanded card, markdown body, blinking cursor, section dots
 *   3. done      — same card, cursor gone, regenerate button exposed
 *   4. error     — red-bordered banner with a Try again button
 *
 * The panel ONLY opens the socket on an explicit user click. It never
 * auto-fires when a scenario result lands — the user pays the latency cost
 * deliberately.
 */
export default function ExplainPanel({ result, lake }: ExplainPanelProps) {
  // Scenario params live in the scenario store, not passed as a prop —
  // they're only needed to hash and for the backend request body.
  const params = useScenarioStore((s) => s.params);

  const [scenarioHash, setScenarioHash] = useState<string | null>(null);

  // Compute the hash whenever the inputs change. Async so no blocking.
  useEffect(() => {
    let cancelled = false;
    computeScenarioHash(lake, params, result).then((hash) => {
      if (!cancelled) setScenarioHash(hash);
    });
    return () => {
      cancelled = true;
    };
  }, [lake, params, result]);

  const activeLanguage = useInterpretationStore((s) =>
    scenarioHash ? s.activeLanguageByHash[scenarioHash] ?? "en" : "en",
  );
  const setActiveLanguage = useInterpretationStore((s) => s.setActiveLanguage);

  // Narrow selector: only this slot's state is subscribed to. If another
  // component happens to mount `interpretationStore`, it won't cause
  // cascades when deltas arrive for an unrelated (hash, lang).
  const slot = useInterpretationStore((s) =>
    scenarioHash ? s.byHash[scenarioHash]?.[activeLanguage] : undefined,
  );

  const { start, cancel } = useExplainStream();

  // Callback used by idle button, regenerate button, and error retry.
  const begin = useCallback(
    (lang: InterpretationLanguage) => {
      if (!scenarioHash) return;
      setActiveLanguage(scenarioHash, lang);
      start({ scenarioHash, lake, params, result, language: lang });
    },
    [lake, params, result, scenarioHash, setActiveLanguage, start],
  );

  // Language chip click: if the slot already has a finished interpretation,
  // just flip the active language (instant cache hit). Otherwise, fire a
  // new stream.
  const onPickLanguage = useCallback(
    (lang: InterpretationLanguage) => {
      if (!scenarioHash) return;
      const existing = useInterpretationStore.getState().get(scenarioHash, lang);
      setActiveLanguage(scenarioHash, lang);
      if (existing && existing.status === "done") {
        // Nothing to do — the store already has the markdown cached.
        return;
      }
      begin(lang);
    },
    [begin, scenarioHash, setActiveLanguage],
  );

  // Cancel any open socket on unmount (e.g. user navigates away mid-stream).
  useEffect(() => {
    return () => cancel();
  }, [cancel]);

  // ─── Render ───────────────────────────────────────────────────────
  // Idle — show the pill button. Also rendered if we haven't computed
  // the scenario hash yet (SHA-256 resolves in <5ms, so this is imperceptible).
  if (!scenarioHash || !slot || slot.status === "idle") {
    return (
      <IdleButton
        disabled={!scenarioHash}
        onClick={() => begin(activeLanguage)}
      />
    );
  }

  // Error state takes priority over streaming UI.
  if (slot.status === "error") {
    return (
      <ErrorBanner
        message={slot.error ?? "Unknown error."}
        onRetry={() => begin(activeLanguage)}
      />
    );
  }

  // Streaming / done → expanded card.
  return (
    <StreamingCard
      slot={slot}
      result={result}
      scenarioHash={scenarioHash}
      activeLanguage={activeLanguage}
      onPickLanguage={onPickLanguage}
      onRegenerate={() => begin(activeLanguage)}
    />
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────

function IdleButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="animate-fade-in-up"
      style={{ animationDelay: "0.15s" }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="group relative w-full overflow-hidden rounded-2xl border border-accent-cyan/30 bg-gradient-to-r from-accent-cyan/10 via-accent-cyan/5 to-transparent px-6 py-5 text-left transition-all duration-200 hover:border-accent-cyan/60 hover:from-accent-cyan/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Cyan glow on hover */}
        <div className="absolute -left-10 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full bg-accent-cyan/10 blur-[60px] transition-opacity duration-300 group-hover:opacity-80 pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-cyan/15 text-accent-cyan shadow-[0_0_20px_rgba(0,212,255,0.25)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-text-primary">
              Ask Gemma to explain these results
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              Powered by Gemma 4 · local Ollama · streams in English, नेपाली, or हिन्दी
            </div>
          </div>
          <div className="shrink-0 rounded-full border border-accent-cyan/30 bg-bg-primary/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent-cyan">
            One click
          </div>
        </div>
      </button>
    </div>
  );
}

function StreamingCard({
  slot,
  result,
  scenarioHash,
  activeLanguage,
  onPickLanguage,
  onRegenerate,
}: {
  slot: InterpretationState;
  result: ScenarioResult;
  scenarioHash: string;
  activeLanguage: InterpretationLanguage;
  onPickLanguage: (lang: InterpretationLanguage) => void;
  onRegenerate: () => void;
}) {
  const isStreaming = slot.status === "streaming" || slot.status === "connecting";
  const awaitingFirstToken = slot.firstTokenAt === null;
  // Show the alerts card only once the main interpretation has reached the
  // end of its five ## sections, OR the server sent a full `done`. Earlier
  // would feel broken — user would see empty bubbles while Gemma is still
  // narrating the Situation paragraph.
  const mainBodyDone =
    slot.status === "done" || slot.completedSections.length >= 5;

  return (
    <div className="animate-fade-in-up rounded-2xl border border-accent-cyan/20 bg-bg-secondary/80 p-5 shadow-[0_0_40px_rgba(0,212,255,0.05)]">
      {/* Header row: Gemma chip + language chips + regenerate */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-cyan/15 text-accent-cyan">
            <Bot className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text-primary">
              Gemma 4
            </span>
            <span className="text-[10px] uppercase tracking-wider text-text-muted">
              Local interpretation
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-border bg-bg-primary/40 p-1">
            {INTERPRETATION_LANGUAGES.map((lang) => {
              const isActive = lang === activeLanguage;
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => onPickLanguage(lang)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all duration-150 ${
                    isActive
                      ? "bg-accent-cyan text-bg-primary shadow-[0_0_12px_rgba(0,212,255,0.4)]"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {LANGUAGE_LABELS[lang]}
                </button>
              );
            })}
          </div>
          {slot.status === "done" && (
            <button
              type="button"
              onClick={onRegenerate}
              title="Regenerate"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-primary/40 text-text-muted transition-colors hover:border-accent-cyan/40 hover:text-accent-cyan"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Section indicator row */}
      <div className="mb-4">
        <ExplainSectionIndicator
          currentSection={slot.currentSection}
          completedSections={slot.completedSections}
        />
      </div>

      {/* Body: markdown or first-token shimmer */}
      <div className="min-h-[80px]">
        {awaitingFirstToken && isStreaming ? (
          <FirstTokenShimmer />
        ) : (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {slot.content}
            </ReactMarkdown>
            {isStreaming && <BlinkingCursor />}
          </div>
        )}
      </div>

      {/* Phase 4: SMS alert drafts — only after main sections are done. */}
      <AlertBubbles
        result={result}
        scenarioHash={scenarioHash}
        language={activeLanguage}
        mainBodyDone={mainBodyDone}
      />
    </div>
  );
}

function FirstTokenShimmer() {
  return (
    <div className="flex items-center gap-2 py-4">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full bg-accent-cyan/70"
            style={{
              animation: `explainBounce 1.2s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
      <span className="text-xs text-text-muted">
        Gemma is reading the results...
      </span>
      <style>{`
        @keyframes explainBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}

function BlinkingCursor() {
  return (
    <>
      <span
        className="ml-0.5 inline-block h-[1em] w-[0.5ch] translate-y-[0.12em] bg-accent-cyan align-middle"
        style={{ animation: "explainCursorBlink 1s steps(2, start) infinite" }}
        aria-hidden
      />
      <style>{`
        @keyframes explainCursorBlink {
          to { visibility: hidden; }
        }
      `}</style>
    </>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  // memoize the trimmed message so it doesn't reflow on every render
  const displayMessage = useMemo(() => message.trim() || "Unknown error.", [message]);

  return (
    <div className="animate-fade-in-up rounded-2xl border border-red-500/30 bg-red-950/20 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary">
            Gemma couldn't complete that interpretation.
          </div>
          <div className="mt-1 text-xs text-text-muted break-words">
            {displayMessage}
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-500/20"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
