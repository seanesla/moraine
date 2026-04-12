import CountdownCard from "./CountdownCard";
import type { VillageResult } from "../../types/scenario";

interface CountdownGridProps {
  villages: VillageResult[];
}

export default function CountdownGrid({ villages }: CountdownGridProps) {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
        Village Arrival Times
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {villages.map((village, i) => (
          <div
            key={village.name}
            className="animate-fade-in-right"
            style={{ animationDelay: `${0.3 + i * 0.08}s` }}
          >
            <CountdownCard village={village} index={i} />
          </div>
        ))}
      </div>
    </div>
  );
}
