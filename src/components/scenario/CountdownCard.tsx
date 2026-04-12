import { Clock, Users, MapPin } from "lucide-react";
import AnimatedNumber from "../common/AnimatedNumber";
import SeverityBadge from "./SeverityBadge";
import { formatMinutes } from "../../lib/formatters";
import { severityConfig, type SeverityLevel } from "../../lib/severity";
import type { VillageResult } from "../../types/scenario";

interface CountdownCardProps {
  village: VillageResult;
  index: number;
}

export default function CountdownCard({ village, index }: CountdownCardProps) {
  const config = severityConfig[village.severity as SeverityLevel];

  return (
    <div
      className="glass-static p-4 transition-all duration-300 hover:-translate-y-[2px] hover:border-white/12 hover:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)]"
      style={{ borderLeftWidth: 3, borderLeftColor: config.color }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-text-primary truncate">{village.name}</h3>
          {village.name_nepali && (
            <span className="text-[10px] text-text-muted">{village.name_nepali}</span>
          )}
        </div>
        <SeverityBadge severity={village.severity as SeverityLevel} />
      </div>

      {/* Big arrival time */}
      <div className="mb-3">
        <AnimatedNumber
          value={village.arrival_time_min}
          decimals={1}
          className="text-3xl font-extrabold font-mono text-text-primary"
          duration={1.2 + index * 0.1}
        />
        <span className="text-sm text-text-muted ml-1">min</span>
        <div className="text-[10px] text-text-muted mt-0.5">
          {formatMinutes(village.arrival_time_low_min)} — {formatMinutes(village.arrival_time_high_min)} range
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2.5 text-[10px] text-text-muted">
        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{village.distance_km} km</span>
        {village.population && (
          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{village.population.toLocaleString()}</span>
        )}
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{Math.round(village.attenuated_discharge_m3s).toLocaleString()} m³/s</span>
      </div>
    </div>
  );
}
