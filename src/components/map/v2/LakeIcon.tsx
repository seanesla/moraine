import { useMemo } from "react";
import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import type { Lake } from "../../../types/lake";

interface LakeIconProps {
  lake: Lake;
  showPopup?: boolean;
}

/**
 * Renders the lake source as a composite divIcon: breathing glow halo,
 * dashed danger-zone ring scaled by volume, dam bar scaled by dam height,
 * and a floating label with name + volume.
 */
export default function LakeIcon({ lake, showPopup = true }: LakeIconProps) {
  const icon = useMemo(() => buildLakeDivIcon(lake), [lake]);

  return (
    <Marker
      position={[lake.lat, lake.lon]}
      icon={icon}
      keyboard={false}
      interactive={showPopup}
    >
      {showPopup && (
        <Popup closeButton={false}>
          <div className="v2-popup-title">{lake.name}</div>
          <div className="v2-popup-sub">
            {lake.elevation_m.toLocaleString()}m elevation
          </div>
        </Popup>
      )}
    </Marker>
  );
}

function buildLakeDivIcon(lake: Lake): L.DivIcon {
  const volumeMm3 = safeVolumeMm3(lake.volume_m3);
  const volumeLabel = volumeMm3 !== null ? `${volumeMm3.toFixed(1)} Mm³` : null;

  // Danger ring radius: volume_m3 / 1e7, clamped so 3M Mm³ is still visible
  // and 110M Mm³ doesn't overflow the map panel (panel is ~400 tall).
  const dangerRadiusPx = clamp(
    Math.sqrt(Math.max(lake.volume_m3 ?? 0, 1_000_000) / 1e6) * 6,
    28,
    72,
  );

  // Dam bar height scaled by dam_height_m, clamped so a 200m dam isn't a
  // skyscraper and a missing value defaults to a sane minimum.
  const damHeightPx = clamp(((lake.dam_height_m ?? 0) * 0.35), 10, 28);

  const size = dangerRadiusPx * 2 + 40;

  const html = `
    <div class="v2-lake-icon" style="width:${size}px;height:${size}px;">
      <div class="v2-lake-danger" style="width:${dangerRadiusPx * 2}px;height:${dangerRadiusPx * 2}px;"></div>
      <div class="v2-lake-glow"></div>
      <div class="v2-lake-core"></div>
      <div class="v2-lake-dam" style="height:${damHeightPx}px;"></div>
      ${volumeLabel ? `<div class="v2-lake-label"><span class="v2-lake-name">${escapeHtml(lake.name)}</span> · <span class="v2-lake-vol">${volumeLabel}</span></div>` : ""}
    </div>
  `;

  return L.divIcon({
    html,
    className: "v2-lake-icon-wrapper",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function safeVolumeMm3(volume_m3: number | undefined | null): number | null {
  if (volume_m3 == null || !isFinite(volume_m3) || volume_m3 <= 0) return null;
  return volume_m3 / 1e6;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
