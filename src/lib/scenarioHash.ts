import type { Lake } from "../types/lake";
import type { ScenarioParams, ScenarioResult } from "../types/scenario";

/**
 * Frontend mirror of the backend's `compute_scenario_hash`.
 *
 * Backend and frontend MUST produce identical hashes for the same scenario,
 * otherwise the explain cache lookup will miss and we'll pay for a re-run
 * every time the user clicks the button.
 *
 * The payload shape mirrors backend/explain_cache.py:
 *   {
 *     lake_id,                       // stable per-lake identifier
 *     params: <sorted by key>,       // so key order doesn't flip the hash
 *     discharge_avg,                 // rounded to 2dp (see note below)
 *     wave_speed,                    // rounded to 2dp
 *     villages: [                    // ordered as returned by the backend
 *       { name, arrival, severity },
 *     ],
 *   }
 *
 * We JSON.stringify the object with `sort_keys`-equivalent behaviour (by
 * explicitly providing a sorted params object) and then SHA-256 it. The first
 * 32 hex characters are used as the key — short enough to log, wide enough
 * (128 bits) to make collisions a non-issue for a demo cache with ≤32 slots.
 */
export async function computeScenarioHash(
  lake: Lake,
  params: ScenarioParams,
  result: ScenarioResult,
): Promise<string> {
  // Sort params by key name so {a:1,b:2} and {b:2,a:1} hash the same.
  const sortedParams: Record<string, number> = {};
  const keys = Object.keys(params).sort() as (keyof ScenarioParams)[];
  for (const key of keys) {
    sortedParams[key] = params[key];
  }

  // Round doubles to 2dp so tiny floating-point drift doesn't bust the cache.
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const payload = {
    lake_id: lake.id,
    params: sortedParams,
    discharge_avg: round2(result.discharge.average_m3s),
    wave_speed: round2(result.wave_speed_mps),
    villages: result.villages.map((v) => ({
      name: v.name,
      arrival: round2(v.arrival_time_min),
      severity: v.severity,
    })),
  };

  const json = JSON.stringify(payload);
  const buf = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 32);
}
