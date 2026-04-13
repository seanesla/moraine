import { useMemo } from "react";
import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import { severityConfig, type SeverityLevel } from "../../../lib/severity";
import { formatMinutes } from "../../../lib/formatters";
import type { VillageResult } from "../../../types/scenario";

export type VillageIconState = "idle" | "warning" | "impact" | "revealed";

interface VillageIconV2Props {
  village: VillageResult;
  lat: number;
  lon: number;
  state?: VillageIconState;
  showPopup?: boolean;
}

export default function VillageIconV2({
  village,
  lat,
  lon,
  state = "idle",
  showPopup = true,
}: VillageIconV2Props) {
  const config = severityConfig[village.severity as SeverityLevel];
  const radius = radiusForPopulation(village.population);

  const icon = useMemo(
    () => buildVillageDivIcon(radius, config.color, state),
    [radius, config.color, state],
  );

  return (
    <Marker
      position={[lat, lon]}
      icon={icon}
      keyboard={false}
      interactive={showPopup}
    >
      {showPopup && (
        <Popup closeButton={false}>
          <div className="v2-popup-title">{village.name}</div>
          <div className="v2-popup-stats">
            <span>T+{formatMinutes(village.arrival_time_min)}</span>
            <span
              className="v2-popup-sev"
              style={{ color: config.color }}
            >
              {village.severity}
            </span>
            {village.population != null && (
              <span className="v2-popup-pop">
                {village.population.toLocaleString()} people
              </span>
            )}
          </div>
        </Popup>
      )}
    </Marker>
  );
}

/**
 * Log-scaled: 6 + log10(max(10, pop)) * 2.4. A 300-pop hamlet lands at ~12px;
 * a 1600-pop town at ~13.7px; missing pop falls back to min floor of 10.
 */
export function radiusForPopulation(population: number | undefined): number {
  const pop = population != null && isFinite(population) && population > 0 ? population : 10;
  return 6 + Math.log10(Math.max(10, pop)) * 2.4;
}

function buildVillageDivIcon(
  radius: number,
  color: string,
  state: VillageIconState,
): L.DivIcon {
  const halo = radius * 2 + 18;
  const core = radius;
  // idle: 55% saturation, warning/impact/revealed bounce up to 100% so the
  // cascade reads as a clear "someone just got hit" beat.
  const saturation = state === "idle" ? 0.55 : 1.0;

  const showBadge = state === "warning";
  const badgeHtml = showBadge
    ? '<div class="v2-village-badge">INCOMING</div>'
    : "";

  const html = `
    <div class="v2-village-icon" data-state="${state}" style="width:${halo}px;height:${halo}px;">
      <div class="v2-village-halo" style="width:${halo}px;height:${halo}px;background:${color}; opacity:${saturation * 0.25};"></div>
      <div class="v2-village-ring" style="width:${halo - 4}px;height:${halo - 4}px;border-color:${color};"></div>
      <div class="v2-village-core" style="width:${core * 2}px;height:${core * 2}px;background:${color}; opacity:${saturation};"></div>
      ${badgeHtml}
    </div>
  `;

  return L.divIcon({
    html,
    className: "v2-village-icon-wrapper",
    iconSize: [halo, halo],
    iconAnchor: [halo / 2, halo / 2],
  });
}
