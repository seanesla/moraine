import { useEffect, useRef } from "react";
import { formatMinutes } from "../../../lib/formatters";
import AnimatedNumber from "../../common/AnimatedNumber";
import { severityConfig, type SeverityLevel } from "../../../lib/severity";
import type { ScenarioResult } from "../../../types/scenario";
import type { Lake } from "../../../types/lake";
import type { HudState, PlaybackPhase } from "./useFloodChoreography";

interface HudOverlayProps {
  lake: Lake;
  result: ScenarioResult;
  phase: PlaybackPhase;
  isPlaying: boolean;
  hudStateRef: React.MutableRefObject<HudState>;
}

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  EXTREME: 5,
  SEVERE: 4,
  HIGH: 3,
  MODERATE: 2,
  LOW: 1,
};

function formatVolume(volume_m3: number): string {
  if (!Number.isFinite(volume_m3) || volume_m3 <= 0) return "—";
  const mm3 = volume_m3 / 1e6;
  if (mm3 >= 100) return `${Math.round(mm3)} Mm³`;
  return `${mm3.toFixed(1)} Mm³`;
}

function computeMaxSeverity(result: ScenarioResult): SeverityLevel {
  let max: SeverityLevel = "LOW";
  let maxRank = 0;
  for (const v of result.villages) {
    const lvl = v.severity as SeverityLevel;
    const rank = SEVERITY_RANK[lvl] ?? 0;
    if (rank > maxRank) {
      maxRank = rank;
      max = lvl;
    }
  }
  return max;
}

function computeTotalPop(result: ScenarioResult): number {
  return result.villages.reduce((sum, v) => sum + (v.population ?? 0), 0);
}

export default function HudOverlay({
  lake,
  result,
  phase,
  isPlaying,
  hudStateRef,
}: HudOverlayProps) {
  const timerRef = useRef<HTMLSpanElement>(null);
  const hitsRef = useRef<HTMLSpanElement>(null);

  // Imperative DOM-write RAF loop. The choreography hook updates
  // hudStateRef.current.modelTimeSec 60x per second inside a tween onUpdate
  // without bumping React — so the only way to keep this ticker in sync
  // without adding React state to the hot path is to poll the ref and
  // write textContent directly.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const hud = hudStateRef.current;
      if (timerRef.current) {
        const min = hud.modelTimeSec / 60;
        timerRef.current.textContent = `T+${formatMinutes(min)}`;
      }
      if (hitsRef.current) {
        hitsRef.current.textContent = String(hud.villagesHit);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, hudStateRef]);

  const totalVillages = result.villages.length;
  const waveSpeed = result.wave_speed_mps;
  const peakQ = result.discharge.average_m3s;
  const maxSeverity = computeMaxSeverity(result);
  const totalPop = computeTotalPop(result);

  let content: React.ReactNode;
  if (phase === "idle") {
    content = (
      <>
        <span className="v2-hud-label">{lake.name}</span>
        <span className="v2-hud-sep">·</span>
        <span className="v2-hud-value">{formatVolume(lake.volume_m3)}</span>
        <span className="v2-hud-sep">·</span>
        <span className="v2-hud-value">
          {Math.round(lake.dam_height_m)}m DAM
        </span>
      </>
    );
  } else if (phase === "charge") {
    content = (
      <>
        <span className="v2-hud-timer">T+0:00</span>
        <span className="v2-hud-sep">·</span>
        <span className="v2-hud-label">DAM INTEGRITY NOMINAL</span>
      </>
    );
  } else if (phase === "breach") {
    content = (
      <>
        <span className="v2-hud-timer">T+0:30</span>
        <span className="v2-hud-sep">·</span>
        <span className="v2-hud-label">DAM BREACH</span>
        <span className="v2-hud-sep">·</span>
        <span className="v2-hud-muted">PEAK Q</span>
        <AnimatedNumber
          value={peakQ}
          duration={0.6}
          className="v2-hud-value v2-hud-num"
        />
        <span className="v2-hud-unit">m³/s</span>
      </>
    );
  } else if (phase === "wave") {
    content = (
      <>
        <span ref={timerRef} className="v2-hud-timer">
          T+0:00
        </span>
        <span className="v2-hud-sep">·</span>
        <span className="v2-hud-value">WAVE {waveSpeed.toFixed(1)} m/s</span>
        <span className="v2-hud-sep">·</span>
        <span ref={hitsRef} className="v2-hud-value">
          0
        </span>
        <span className="v2-hud-muted">/{totalVillages} HIT</span>
      </>
    );
  } else {
    // aftermath
    content = (
      <>
        <span className="v2-hud-label">POP AT RISK</span>
        <AnimatedNumber
          value={totalPop}
          duration={1.0}
          className="v2-hud-value v2-hud-num"
        />
        <span className="v2-hud-sep">·</span>
        <span className="v2-hud-value">
          {hudStateRef.current.villagesHit}/{totalVillages} HIT
        </span>
        <span className="v2-hud-sep">·</span>
        <span
          className="v2-hud-value"
          style={{ color: severityConfig[maxSeverity].color }}
        >
          {maxSeverity}
        </span>
      </>
    );
  }

  return (
    <div className="v2-hud-overlay" data-phase={phase}>
      {content}
    </div>
  );
}
