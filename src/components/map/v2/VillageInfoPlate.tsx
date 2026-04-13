import { useEffect, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type L from "leaflet";
import AnimatedNumber from "../../common/AnimatedNumber";
import { formatMinutes } from "../../../lib/formatters";
import {
  severityConfig,
  type SeverityLevel,
} from "../../../lib/severity";
import type { VillageResult } from "../../../types/scenario";

interface VillageInfoPlateProps {
  village: VillageResult;
  lat: number;
  lon: number;
}

/**
 * Glass plate that slides out horizontally from a village marker when the
 * choreography hook marks it `revealed`. Contains animated discharge
 * count-up, severity badge, arrival time, and population-at-risk.
 *
 * Positioning strategy: we read `map.latLngToContainerPoint(latlon)` on
 * mount and on every Leaflet move/zoom event so the plate stays locked to
 * the village as the user pans the map.
 */
const PLATE_WIDTH = 240;
const PLATE_MARGIN = 18;

interface Placement {
  x: number;
  y: number;
  flipped: boolean;
}

function computePlacement(
  map: L.Map,
  lat: number,
  lon: number,
): Placement {
  const p = map.latLngToContainerPoint([lat, lon]);
  const size = map.getSize();
  const wouldOverflowRight =
    p.x + PLATE_MARGIN + PLATE_WIDTH > size.x - 8;
  const flipped = wouldOverflowRight;
  return { x: p.x, y: p.y, flipped };
}

export default function VillageInfoPlate({
  village,
  lat,
  lon,
}: VillageInfoPlateProps) {
  const map = useMap();
  const [placement, setPlacement] = useState<Placement>(() =>
    computePlacement(map, lat, lon),
  );

  useEffect(() => {
    setPlacement(computePlacement(map, lat, lon));
  }, [map, lat, lon]);

  useMapEvents({
    move: () => setPlacement(computePlacement(map, lat, lon)),
    zoom: () => setPlacement(computePlacement(map, lat, lon)),
    resize: () => setPlacement(computePlacement(map, lat, lon)),
  });

  const config = severityConfig[village.severity as SeverityLevel];
  const population = village.population ?? 0;

  const left = placement.flipped
    ? placement.x - PLATE_WIDTH - PLATE_MARGIN
    : placement.x + PLATE_MARGIN;

  return (
    <div
      className="v2-info-plate"
      data-flipped={placement.flipped ? "true" : "false"}
      style={{
        position: "absolute",
        left: `${left}px`,
        top: `${placement.y - 22}px`,
        borderColor: config.color,
      }}
    >
      <div className="v2-info-plate-header">
        <span className="v2-info-plate-name">{village.name}</span>
        <span
          className="v2-info-plate-badge"
          style={{ background: config.gradient, color: config.textColor }}
        >
          {config.label}
        </span>
      </div>

      <div className="v2-info-plate-row">
        <span className="v2-info-plate-label">Peak Q</span>
        <span className="v2-info-plate-value" style={{ color: config.color }}>
          <AnimatedNumber
            value={village.attenuated_discharge_m3s}
            decimals={0}
            duration={0.9}
          />
          <span className="v2-info-plate-unit"> m³/s</span>
        </span>
      </div>

      <div className="v2-info-plate-row">
        <span className="v2-info-plate-label">Arrival</span>
        <span className="v2-info-plate-value">
          T+{formatMinutes(village.arrival_time_min)}
        </span>
      </div>

      {population > 0 && (
        <div className="v2-info-plate-row">
          <span className="v2-info-plate-label">At risk</span>
          <span className="v2-info-plate-value">
            <AnimatedNumber value={population} decimals={0} duration={0.9} />
            <span className="v2-info-plate-unit"> people</span>
          </span>
        </div>
      )}
    </div>
  );
}
