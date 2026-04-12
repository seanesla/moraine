import { ArrowLeft } from "lucide-react";

export default function WelcomeScreen() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 animate-fade-in-up">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-[42px] font-bold tracking-[0.06em] text-text-primary/90"
          style={{ textShadow: "0 0 40px var(--color-glow-primary), 0 0 80px rgba(0,212,255,0.15)" }}>
          moraine
        </h1>
        <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted/60 font-medium">
          glacial lake outburst flood simulator
        </p>
      </div>
      <div className="flex items-center gap-2 text-text-muted/50 text-xs mt-4">
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Select a lake and run a scenario</span>
      </div>
    </div>
  );
}
