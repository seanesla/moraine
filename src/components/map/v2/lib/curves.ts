export type LatLon = [number, number];

/**
 * Deterministic -1 | 1 from a string. Same village name always curves the
 * same direction; villages inside one lake must scatter to both sides so
 * rivers don't all meander the same way.
 *
 * Uses two interleaved FNV/murmur-style hashes with a final avalanche mix
 * to defeat common prefix/suffix patterns (e.g. "-boche", "-gaun") that a
 * plain 31x rolling hash collides on.
 */
export function hashSign(name: string): -1 | 1 {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x1b873593 >>> 0;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 3) | (c >>> 5)), 0x85ebca6b) >>> 0;
  }
  let h = (h1 ^ h2) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return (h & 1) === 0 ? 1 : -1;
}

/**
 * Quadratic Bezier sampled in lat/lon space.
 *
 * Control point sits at the midpoint of start->end, offset along the
 * perpendicular by `curvature * side`. Perpendicular is already scaled by
 * the path length (rotating the delta vector), so the offset grows with
 * distance — a 2 km river doesn't overshoot and a 185 km river doesn't
 * look straight.
 */
export function quadraticBezierPoints(
  start: LatLon,
  end: LatLon,
  curvature: number,
  side: -1 | 1,
  steps = 32,
): LatLon[] {
  const [lat0, lon0] = start;
  const [lat1, lon1] = end;

  const dLat = lat1 - lat0;
  const dLon = lon1 - lon0;

  const midLat = (lat0 + lat1) / 2;
  const midLon = (lon0 + lon1) / 2;

  const perpLat = -dLon;
  const perpLon = dLat;

  const ctrlLat = midLat + perpLat * curvature * side;
  const ctrlLon = midLon + perpLon * curvature * side;

  const pts: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const lat = mt * mt * lat0 + 2 * mt * t * ctrlLat + t * t * lat1;
    const lon = mt * mt * lon0 + 2 * mt * t * ctrlLon + t * t * lon1;
    pts.push([lat, lon]);
  }
  return pts;
}
