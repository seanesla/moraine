import { useMemo } from "react";
import AnimatedNumber from "../../common/AnimatedNumber";
import { formatMinutes } from "../../../lib/formatters";
import { severityConfig, type SeverityLevel } from "../../../lib/severity";
import type { VillageResult } from "../../../types/scenario";
import type { VillageIconState } from "./VillageIconV2";

interface VillageCalloutPanelProps {
  villages: VillageResult[];
  villageStates: Map<string, VillageIconState>;
}

export default function VillageCalloutPanel({
  villages,
  villageStates,
}: VillageCalloutPanelProps) {
  const revealedSorted = useMemo(
    () =>
      [...villages]
        .filter((v) => villageStates.get(v.name) === "revealed")
        .sort((a, b) => a.distance_km - b.distance_km),
    [villages, villageStates],
  );

  if (revealedSorted.length === 0) return null;

  return (
    <div className="v2-callout-panel" aria-label="Village impact details">
      {revealedSorted.map((village) => (
        <VillageCalloutCard key={village.name} village={village} />
      ))}
    </div>
  );
}

function VillageCalloutCard({ village }: { village: VillageResult }) {
  const config = severityConfig[village.severity as SeverityLevel];
  const population = village.population ?? 0;

  return (
    <div
      className="v2-callout-card"
      style={{ borderLeftColor: config.color }}
    >
      <div className="v2-callout-card-header">
        <span className="v2-callout-card-name">{village.name}</span>
        <span
          className="v2-callout-card-badge"
          style={{ background: config.gradient, color: config.textColor }}
        >
          {config.label}
        </span>
      </div>

      <div className="v2-callout-card-grid">
        <div className="v2-callout-card-row">
          <span className="v2-callout-card-label">Peak Q</span>
          <span
            className="v2-callout-card-value"
            style={{ color: config.color }}
          >
            <AnimatedNumber
              value={village.attenuated_discharge_m3s}
              decimals={0}
              duration={0.9}
            />
            <span className="v2-callout-card-unit"> m³/s</span>
          </span>
        </div>

        <div className="v2-callout-card-row">
          <span className="v2-callout-card-label">Arrival</span>
          <span className="v2-callout-card-value">
            T+{formatMinutes(village.arrival_time_min)}
          </span>
        </div>

        <div className="v2-callout-card-row">
          <span className="v2-callout-card-label">Distance</span>
          <span className="v2-callout-card-value">
            {village.distance_km.toFixed(1)}
            <span className="v2-callout-card-unit"> km</span>
          </span>
        </div>

        {population > 0 && (
          <div className="v2-callout-card-row">
            <span className="v2-callout-card-label">At risk</span>
            <span className="v2-callout-card-value">
              <AnimatedNumber
                value={population}
                decimals={0}
                duration={0.9}
              />
              <span className="v2-callout-card-unit"> people</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
