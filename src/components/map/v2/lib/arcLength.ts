/** [lat, lon] in Leaflet order. */
export type LatLon = [number, number];

const EARTH_R_M = 6_371_008.8;

/** Great-circle distance between two [lat, lon] points in meters. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const h =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(h));
}

/**
 * Precomputed arc-length parameterization of a polyline.
 *
 * `cumulative[i]` is the haversine distance (meters) from the start of
 * the polyline to `path[i]`. `total` is the full polyline length.
 *
 * The flood-wave shader uses this so "progress along the river" means
 * actual ground distance, not point-index — critical for unevenly
 * sampled polylines like real DEM flow traces where dense meanders and
 * sparse straight reaches would otherwise make the wave visually speed
 * up and slow down even though `uProgress` ticks linearly.
 */
export interface ArcLengthTable {
  path: LatLon[];
  cumulative: number[];
  total: number;
}

export function buildArcLengthTable(path: LatLon[]): ArcLengthTable {
  if (path.length === 0) {
    return { path, cumulative: [], total: 0 };
  }
  const cumulative = new Array<number>(path.length);
  cumulative[0] = 0;
  let running = 0;
  for (let i = 1; i < path.length; i++) {
    running += haversineMeters(path[i - 1], path[i]);
    cumulative[i] = running;
  }
  return { path, cumulative, total: running };
}

/**
 * Sample the polyline at arc-length parameter `t` in [0, 1].
 *
 * t=0 returns the first point, t=1 returns the last point, and
 * intermediate values return linearly interpolated positions such that
 * the returned point is exactly at `t * total_length` meters along the
 * polyline.
 */
export function interpolateAtArcLength(
  table: ArcLengthTable,
  t: number,
): LatLon {
  const { path, cumulative, total } = table;
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  const clamped = Math.max(0, Math.min(1, t));
  const target = clamped * total;

  // Binary search for the segment whose cumulative range contains `target`.
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (cumulative[mid] <= target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const segLen = cumulative[hi] - cumulative[lo];
  const f = segLen > 0 ? (target - cumulative[lo]) / segLen : 0;
  const [la0, lo0] = path[lo];
  const [la1, lo1] = path[hi];
  return [la0 + (la1 - la0) * f, lo0 + (lo1 - lo0) * f];
}

/**
 * Development-only sanity check. Not called from production code.
 * Manually invoke from a dev console or useEffect if you need to
 * verify the math after a change.
 */
export function _arcLengthSelfTest(): void {
  // Right-angle path: 0.001° east, then 0.001° north. Each leg ≈ 111 m.
  const path: LatLon[] = [
    [0, 0],
    [0, 0.001],
    [0.001, 0.001],
  ];
  const table = buildArcLengthTable(path);
  console.assert(
    Math.abs(table.total - 2 * haversineMeters([0, 0], [0, 0.001])) < 1,
    "[arcLength] total length mismatch",
    table.total,
  );

  const mid = interpolateAtArcLength(table, 0.5);
  console.assert(
    Math.abs(mid[0] - 0) < 1e-9 && Math.abs(mid[1] - 0.001) < 1e-9,
    "[arcLength] t=0.5 should be the corner",
    mid,
  );

  const start = interpolateAtArcLength(table, 0);
  console.assert(
    start[0] === 0 && start[1] === 0,
    "[arcLength] t=0 should be start",
    start,
  );

  const end = interpolateAtArcLength(table, 1);
  console.assert(
    end[0] === 0.001 && end[1] === 0.001,
    "[arcLength] t=1 should be end",
    end,
  );

  // Quarter position should fall halfway along the first segment.
  const quarter = interpolateAtArcLength(table, 0.25);
  console.assert(
    Math.abs(quarter[0] - 0) < 1e-9 && Math.abs(quarter[1] - 0.0005) < 1e-9,
    "[arcLength] t=0.25 should be midway along first leg",
    quarter,
  );
}
