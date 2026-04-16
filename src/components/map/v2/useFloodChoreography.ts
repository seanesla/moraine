import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { gsap } from "gsap";
import type { ScenarioResult } from "../../../types/scenario";
import type { Lake } from "../../../types/lake";
import { computePlaybackTiming, type TimingPlan } from "./lib/timing";
import type { FloodShaderHandle } from "./shaders/FloodShaderCanvas";
import type { LatLon } from "./lib/arcLength";

export type VillageState = "idle" | "warning" | "impact" | "revealed";
export type PlaybackPhase = "idle" | "charge" | "breach" | "wave" | "aftermath";

/**
 * Hot-path state owned by refs so the 60 fps GSAP timeline never triggers
 * React re-renders. Villages publish state changes by bumping a reducer;
 * HUD components read hudStateRef either on their own RAF or on the same
 * reducer bump, depending on whether they're time-critical.
 */
export interface HudState {
  phase: PlaybackPhase;
  modelTimeSec: number;
  villagesHit: number;
  modelSeconds: number;
  playbackSeconds: number;
}

export interface ChoreographyRefs {
  shaderHandleRef: React.MutableRefObject<FloodShaderHandle | null>;
  villageStateRef: React.MutableRefObject<Map<string, VillageState>>;
  hudStateRef: React.MutableRefObject<HudState>;
  /** Village name -> [lat, lon] for triggerImpactAt lookups. */
  villageLatLngRef: React.MutableRefObject<Map<string, LatLon>>;
}

export interface ChoreographyApi {
  play(): void;
  pause(): void;
  reset(): void;
  isPlaying: boolean;
  plan: TimingPlan | null;
}

// Act offsets (seconds from timeline start).
const ACT1_DURATION = 1.5;
const ACT2_DURATION = 0.8;
const ACT3_START = ACT1_DURATION + ACT2_DURATION; // 2.3s
const ACT5_DURATION = 2.0;

const INITIAL_HUD: HudState = {
  phase: "idle",
  modelTimeSec: 0,
  villagesHit: 0,
  modelSeconds: 0,
  playbackSeconds: 8,
};

export function useFloodChoreography(
  result: ScenarioResult,
  lake: Lake,
  refs: ChoreographyRefs,
): ChoreographyApi {
  const [isPlaying, setIsPlaying] = useState(false);
  const [plan, setPlan] = useState<TimingPlan | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  // Bump to force VillageIconV2 / plates to re-read the refs after a
  // state-machine transition. The value itself is unused — we only care
  // about the "something changed" signal React provides.
  const [, bump] = useReducer((x: number) => x + 1, 0);

  // Build timeline once per (result, lake) change. Inline functions read
  // refs.current each call so we never close over stale state.
  useEffect(() => {
    const timing = computePlaybackTiming(result);
    setPlan(timing);

    // Seed hud ref with plan metadata so the HUD can show model-time
    // totals even before play is pressed.
    refs.hudStateRef.current = {
      ...INITIAL_HUD,
      modelSeconds: timing.modelSeconds,
      playbackSeconds: timing.playbackSeconds,
    };
    refs.villageStateRef.current.clear();
    bump();

    if (timing.villages.length === 0) {
      timelineRef.current?.kill();
      timelineRef.current = null;
      return;
    }

    const tl = gsap.timeline({
      paused: true,
      onComplete: () => setIsPlaying(false),
    });

    // --- Act 1: Charge (0 → 1.5s) --------------------------------------
    tl.call(
      () => {
        refs.hudStateRef.current.phase = "charge";
        refs.shaderHandleRef.current?.setIntensity(0);
        bump();
      },
      [],
      0,
    );

    // --- Act 2: Breach (1.5 → 2.3s) ------------------------------------
    tl.call(
      () => {
        refs.hudStateRef.current.phase = "breach";
        refs.shaderHandleRef.current?.triggerBreach();
        bump();
      },
      [],
      ACT1_DURATION,
    );

    // --- Act 3: Wave travel (2.3 → 2.3 + playbackSeconds) --------------
    // Drive uProgress via a tween on a proxy object. onUpdate pushes the
    // value into the shader and updates the HUD ref. No React state.
    tl.call(
      () => {
        refs.hudStateRef.current.phase = "wave";
        bump();
      },
      [],
      ACT3_START,
    );

    const waveProxy = { p: 0 };
    tl.to(
      waveProxy,
      {
        p: 1,
        duration: timing.playbackSeconds,
        ease: "power2.out",
        onStart: () => {
          waveProxy.p = 0;
          refs.shaderHandleRef.current?.setIntensity(1);
        },
        onUpdate: () => {
          refs.shaderHandleRef.current?.setProgress(waveProxy.p);
          refs.hudStateRef.current.modelTimeSec =
            waveProxy.p * timing.modelSeconds;
        },
      },
      ACT3_START,
    );

    // --- Act 4: Village cascade (interleaved with Act 3) ---------------
    for (const vt of timing.villages) {
      const warningAt = ACT3_START + vt.scaledWarningSec;
      const impactAt = ACT3_START + vt.scaledArrivalSec;
      const revealAt = ACT3_START + vt.scaledRevealSec;
      const name = vt.name;

      tl.call(
        () => {
          refs.villageStateRef.current.set(name, "warning");
          bump();
        },
        [],
        warningAt,
      );

      tl.call(
        () => {
          refs.villageStateRef.current.set(name, "impact");
          refs.hudStateRef.current.villagesHit += 1;
          const latLng = refs.villageLatLngRef.current.get(name);
          if (latLng) {
            refs.shaderHandleRef.current?.triggerImpactAt(latLng);
          }
          bump();
        },
        [],
        impactAt,
      );

      tl.call(
        () => {
          refs.villageStateRef.current.set(name, "revealed");
          bump();
        },
        [],
        revealAt,
      );
    }

    // --- Act 5: Aftermath (end → end + 2s) -----------------------------
    const act5Start = ACT3_START + timing.playbackSeconds;
    tl.call(
      () => {
        refs.hudStateRef.current.phase = "aftermath";
        refs.shaderHandleRef.current?.setIntensity(0.15);
        refs.hudStateRef.current.modelTimeSec = timing.modelSeconds;
        bump();
      },
      [],
      act5Start,
    );

    // Pad the timeline so the aftermath phase lasts ACT5_DURATION before
    // onComplete fires and flips isPlaying back to false. A no-op call at
    // the padded end forces the timeline to include those trailing seconds.
    tl.call(() => {}, [], act5Start + ACT5_DURATION);

    timelineRef.current = tl;

    return () => {
      tl.kill();
      if (timelineRef.current === tl) {
        timelineRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, lake]);

  const play = useCallback(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    // Clear any residual state from a prior playback so the cascade fires
    // cleanly from village zero.
    const currentPlan = plan;
    refs.villageStateRef.current.clear();
    refs.hudStateRef.current = {
      ...INITIAL_HUD,
      modelSeconds: currentPlan?.modelSeconds ?? 0,
      playbackSeconds: currentPlan?.playbackSeconds ?? 8,
    };
    refs.shaderHandleRef.current?.setIntensity(0);
    refs.shaderHandleRef.current?.setProgress(0);
    bump();
    tl.restart();
    setIsPlaying(true);
  }, [plan, refs]);

  const pause = useCallback(() => {
    timelineRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const reset = useCallback(() => {
    timelineRef.current?.pause(0);
    refs.shaderHandleRef.current?.setProgress(0);
    refs.shaderHandleRef.current?.setIntensity(0);
    refs.villageStateRef.current.clear();
    // Preserve plan metadata on the hud so totals still display. We
    // overwrite *after* pause(0) so any seek-triggered .call callbacks
    // (which may flip phase back to "charge") get clobbered on the final
    // render below.
    refs.hudStateRef.current = {
      ...INITIAL_HUD,
      modelSeconds: plan?.modelSeconds ?? 0,
      playbackSeconds: plan?.playbackSeconds ?? 8,
    };
    bump();
    setIsPlaying(false);
  }, [plan, refs]);

  return { play, pause, reset, isPlaying, plan };
}
