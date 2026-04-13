import { useCallback, useMemo, useState } from "react";
import { Check, Copy, MessageSquare } from "lucide-react";
import { useInterpretationStore } from "../../stores/interpretationStore";
import type { InterpretationLanguage } from "../../types/interpretation";
import type { ScenarioResult, VillageResult } from "../../types/scenario";

interface AlertBubblesProps {
  result: ScenarioResult;
  scenarioHash: string;
  language: InterpretationLanguage;
  /**
   * True once the main interpretation stream has finished its five ##
   * sections (or was loaded from cache). Before that, the card is hidden
   * entirely so users don't see empty shimmer rows while Gemma is still
   * narrating the Situation section.
   */
  mainBodyDone: boolean;
}

const SMS_CHAR_LIMIT = 160;

/**
 * The "agency moment" UI: Gemma's per-village SMS drafts, rendered as phone
 * bubble-style cards with a Copy button each. Each card is one village, one
 * SMS. No backend round-trip — alerts arrive on the same /ws/explain socket
 * via `alert` events that are already routed into `interpretationStore`.
 */
export default function AlertBubbles({
  result,
  scenarioHash,
  language,
  mainBodyDone,
}: AlertBubblesProps) {
  // Narrow selector: only this (hash, lang) slot's alerts map. Unrelated slots
  // don't trigger re-renders when an alert arrives.
  const alerts = useInterpretationStore(
    (s) => s.byHash[scenarioHash]?.[language]?.alerts,
  );

  // Order villages by arrival time — most urgent first, matching the prompt.
  const orderedVillages = useMemo(
    () =>
      [...result.villages].sort(
        (a, b) => a.arrival_time_min - b.arrival_time_min,
      ),
    [result.villages],
  );

  // Hide entirely until the main interpretation body is done OR at least
  // one alert has already arrived (edge case: a cached slot with alerts but
  // no completedSections entries).
  const hasAnyAlert = alerts && Object.keys(alerts).length > 0;
  if (!mainBodyDone && !hasAnyAlert) {
    return null;
  }

  return (
    <div className="mt-5 animate-fade-in-up">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-cyan/15 text-accent-cyan">
          <MessageSquare className="h-3.5 w-3.5" />
        </div>
        <div>
          <div className="text-[13px] font-bold text-text-primary">
            Draft SMS alerts
          </div>
          <div className="text-[10px] text-text-muted">
            Per-village drafts from Gemma · copy and send
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {orderedVillages.map((village) => {
          const sms = alerts?.[village.name];
          if (!sms) {
            return <AlertBubbleShimmer key={village.name} village={village} />;
          }
          return (
            <AlertBubble
              key={village.name}
              village={village}
              sms={sms}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────

function AlertBubble({
  village,
  sms,
}: {
  village: VillageResult;
  sms: string;
}) {
  const [copied, setCopied] = useState(false);
  const charCount = sms.length;
  const overLimit = charCount > SMS_CHAR_LIMIT;

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sms);
      setCopied(true);
      // Brief confirmation, then revert.
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in restricted contexts — soft fail silently;
      // the SMS is still visible on screen for manual selection.
    }
  }, [sms]);

  return (
    <div className="rounded-xl border border-border bg-bg-primary/40 p-3 transition-colors hover:border-accent-cyan/30">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <div className="text-[13px] font-semibold text-text-primary truncate">
            {village.name}
          </div>
          {village.name_nepali && village.name_nepali !== village.name && (
            <div className="text-[11px] text-text-muted truncate">
              {village.name_nepali}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10px] font-mono tabular-nums ${
              overLimit ? "text-red-400" : "text-text-muted"
            }`}
          >
            {charCount} / {SMS_CHAR_LIMIT}
          </span>
          <button
            type="button"
            onClick={onCopy}
            title="Copy SMS"
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-all duration-150 ${
              copied
                ? "border-green-500/40 bg-green-500/10 text-green-400"
                : "border-border bg-bg-primary/60 text-text-muted hover:border-accent-cyan/40 hover:text-accent-cyan"
            }`}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* The SMS text itself — styled like a phone bubble. */}
      <div className="rounded-2xl rounded-tl-sm border border-accent-cyan/20 bg-accent-cyan/[0.06] px-3.5 py-2.5 text-[13px] leading-relaxed text-text-primary whitespace-pre-wrap break-words">
        {sms}
      </div>
    </div>
  );
}

function AlertBubbleShimmer({ village }: { village: VillageResult }) {
  return (
    <div className="rounded-xl border border-border bg-bg-primary/40 p-3 opacity-70">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[13px] font-semibold text-text-muted truncate">
          {village.name}
        </div>
        <span className="text-[10px] font-mono text-text-muted">— / 160</span>
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-border bg-bg-primary/40 px-3.5 py-2.5">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-accent-cyan/40"
              style={{
                animation: `alertShimmer 1.2s ease-in-out ${i * 0.15}s infinite`,
              }}
            />
          ))}
        </div>
        <style>{`
          @keyframes alertShimmer {
            0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
            30% { opacity: 1; transform: translateY(-3px); }
          }
        `}</style>
      </div>
    </div>
  );
}
