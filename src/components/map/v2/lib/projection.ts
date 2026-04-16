import type { Map as LeafletMap } from "leaflet";
import type { LatLon } from "./arcLength";

/**
 * Convert a [lat, lon] to CSS pixel coords in the map container.
 * Returns [x, y] with top-left origin. Leaflet handles the zoom/pan math;
 * this helper just normalizes the return shape.
 */
export function latLngToScreen(map: LeafletMap, latLng: LatLon): [number, number] {
  const p = map.latLngToContainerPoint(latLng);
  return [p.x, p.y];
}
