/**
 * Physics-grounded playback timing derived from a ScenarioResult.
 *
 * The timing plan maps each village's *real* arrival_time_min onto scaled
 * playback seconds so the choreography hook can schedule warning / impact /
 * reveal beats at their physically correct offsets (relative to Act 3 start).
 *
 * Formula (matches plan section 3):
 *   modelSeconds   = farthestVillage.arrival_time_min * 60
 *   playbackSecs   = clamp(8, sqrt(farthestVillage.distance_km) * 2, 18)
 *   compression    = modelSeconds / playbackSecs
 *   scaledArrival  = (v.arrival_time_min * 60) / compression
 *
 * Notes:
 * - We ignore any village without a finite arrival_time_min (e.g. wave_speed
 *   degenerate). Those are filtered out so compression never divides by 0.
 * - An empty set falls back to a safe 8s plan so hook code never crashes.
 */
export interface VillageTiming {
  name: string;
  distance_km: number;
  arrival_time_min: number;
  scaledArrivalSec: number;
  scaledWarningSec: number;
  scaledRevealSec: number;
}

export interface TimingPlan {
  playbackSeconds: number;
  modelSeconds: number;
  compression: number;
  maxDistanceKm: number;
  villages: VillageTiming[];
}

const WARNING_LEAD_SEC = 0.4;
const REVEAL_TRAIL_SEC = 0.6;

interface VillageLike {
  name: string;
  distance_km: number;
  arrival_time_min: number;
}

export function computePlaybackTiming(result: {
  villages: VillageLike[];
}): TimingPlan {
  const usable = result.villages.filter(
    (v) => Number.isFinite(v.arrival_time_min) && Number.isFinite(v.distance_km),
  );

  if (usable.length === 0) {
    return {
      playbackSeconds: 8,
      modelSeconds: 0,
      compression: 1,
      maxDistanceKm: 0,
      villages: [],
    };
  }

  const sorted = [...usable].sort((a, b) => a.distance_km - b.distance_km);
  const farthest = sorted[sorted.length - 1];
  const maxDistanceKm = farthest.distance_km || 1;
  const modelSeconds = Math.max(0, farthest.arrival_time_min * 60);

  const playbackSeconds = clamp(Math.sqrt(maxDistanceKm) * 2, 8, 18);
  // Avoid divide-by-zero if modelSeconds is 0 (e.g. degenerate/instant wave).
  const compression = modelSeconds > 0 ? modelSeconds / playbackSeconds : 1;

  const villages: VillageTiming[] = sorted.map((v) => {
    const scaledArrivalSec =
      compression > 0 ? (v.arrival_time_min * 60) / compression : 0;
    return {
      name: v.name,
      distance_km: v.distance_km,
      arrival_time_min: v.arrival_time_min,
      scaledArrivalSec,
      scaledWarningSec: Math.max(0, scaledArrivalSec - WARNING_LEAD_SEC),
      scaledRevealSec: scaledArrivalSec + REVEAL_TRAIL_SEC,
    };
  });

  return {
    playbackSeconds,
    modelSeconds,
    compression,
    maxDistanceKm,
    villages,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
