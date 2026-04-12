import { Waves, Wind, Gauge } from "lucide-react";
import AnimatedNumber from "../common/AnimatedNumber";
import type { ScenarioResult } from "../../types/scenario";

interface ResultsHeroProps {
  result: ScenarioResult;
}

export default function ResultsHero({ result }: ResultsHeroProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-950/40 via-bg-secondary to-bg-secondary p-6 animate-fade-in-up">
      {/* Background glow */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-red-500/5 to-orange-500/5 pointer-events-none" />
      <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-red-500/[0.06] blur-[80px] pointer-events-none" />

      {/* Alert header */}
      <div className="relative z-10 mb-5">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-bold uppercase tracking-widest mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
          GLOF Alert
        </div>
        <h2 className="text-xl font-bold text-text-primary">
          Scenario Results
        </h2>
      </div>

      {/* Stats grid */}
      <div className="relative z-10 grid grid-cols-3 gap-4">
        <StatCard
          icon={<Waves className="w-4 h-4" />}
          label="Peak Discharge"
          value={result.discharge.average_m3s}
          suffix=" m³/s"
          decimals={0}
          sublabel={`${result.discharge.low_m3s.toLocaleString()} — ${result.discharge.high_m3s.toLocaleString()}`}
          color="text-red-400"
          iconBg="bg-red-500/10"
          delay={0.1}
        />
        <StatCard
          icon={<Wind className="w-4 h-4" />}
          label="Wave Speed"
          value={result.wave_speed_mps}
          suffix=" m/s"
          decimals={1}
          sublabel={`${(result.wave_speed_mps * 3.6).toFixed(1)} km/h`}
          color="text-orange-400"
          iconBg="bg-orange-500/10"
          delay={0.2}
        />
        <StatCard
          icon={<Gauge className="w-4 h-4" />}
          label="Flow Velocity"
          value={result.flow_velocity_mps}
          suffix=" m/s"
          decimals={1}
          sublabel={`Manning's R = ${result.hydraulic_radius_m}m`}
          color="text-amber-400"
          iconBg="bg-amber-500/10"
          delay={0.3}
        />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  suffix,
  decimals,
  sublabel,
  color,
  iconBg,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix: string;
  decimals: number;
  sublabel: string;
  color: string;
  iconBg: string;
  delay: number;
}) {
  return (
    <div
      className="rounded-xl bg-bg-primary/50 border border-border p-4 animate-scale-in"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-7 h-7 rounded-lg ${iconBg} ${color} flex items-center justify-center`}>
          {icon}
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </span>
      </div>
      <AnimatedNumber
        value={value}
        decimals={decimals}
        suffix={suffix}
        className={`text-2xl font-bold font-mono ${color}`}
        duration={1.5}
      />
      <div className="text-[11px] text-text-muted mt-1">{sublabel}</div>
    </div>
  );
}
