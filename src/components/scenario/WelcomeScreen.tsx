import { AlertTriangle, Clock, MapPin, Zap } from "lucide-react";

export default function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 relative overflow-hidden">
      {/* Background glow effect */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-accent-cyan/[0.03] blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] rounded-full bg-accent-blue/[0.02] blur-[100px] pointer-events-none" />

      {/* Hero content */}
      <div className="text-center max-w-xl mb-12 relative z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent-cyan/20 bg-accent-cyan/5 text-accent-cyan text-[11px] font-semibold uppercase tracking-widest mb-6">
          <Zap className="w-3 h-3" />
          Early Warning System
        </div>
        <h1 className="text-6xl font-extrabold mb-5 leading-none">
          <span className="bg-gradient-to-r from-accent-cyan via-accent-blue to-accent-indigo bg-clip-text text-transparent">
            Moraine
          </span>
        </h1>
        <p className="text-base text-text-secondary leading-relaxed max-w-md mx-auto">
          Estimate flood wave arrival times for downstream villages
          after a glacial lake dam breach. Select a lake and run a scenario.
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-3 gap-5 max-w-2xl w-full relative z-10">
        <FeatureCard
          icon={<AlertTriangle className="w-5 h-5" />}
          iconColor="text-severity-extreme"
          iconBg="bg-red-500/10"
          title="Severity Rating"
          description="EXTREME to LOW classification based on attenuated discharge"
        />
        <FeatureCard
          icon={<Clock className="w-5 h-5" />}
          iconColor="text-accent-cyan"
          iconBg="bg-cyan-500/10"
          title="Arrival Times"
          description="Min/expected/max windows using dual discharge models"
        />
        <FeatureCard
          icon={<MapPin className="w-5 h-5" />}
          iconColor="text-accent-blue"
          iconBg="bg-blue-500/10"
          title="Flood Mapping"
          description="Interactive map with village impact zones and paths"
        />
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  iconColor,
  iconBg,
  title,
  description,
}: {
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
}) {
  return (
    <div className="glass p-5 text-center group hover:border-white/10 transition-all duration-300">
      <div
        className={`w-10 h-10 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center mx-auto mb-3`}
      >
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-text-primary mb-1.5">{title}</h3>
      <p className="text-[11px] text-text-muted leading-relaxed">{description}</p>
    </div>
  );
}
