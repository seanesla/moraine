import { severityConfig, type SeverityLevel } from "../../lib/severity";

const severityBands: Array<{
  level: SeverityLevel;
  threshold: string;
}> = [
  { level: "EXTREME", threshold: ">5,000 m³/s" },
  { level: "SEVERE", threshold: ">1,000 m³/s" },
  { level: "HIGH", threshold: ">500 m³/s" },
  { level: "MODERATE", threshold: ">100 m³/s" },
  { level: "LOW", threshold: "≤100 m³/s" },
];

export default function FloodMapLegend() {
  return (
    <div
      className="absolute left-3 bottom-3 z-[800] pointer-events-auto select-none"
      style={{
        background: "rgba(17, 17, 19, 0.82)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        minWidth: 200,
        maxWidth: 260,
      }}
    >
      <div className="text-[9px] font-semibold uppercase tracking-widest text-text-muted mb-2">
        Legend
      </div>

      {/* Severity bands */}
      <div className="space-y-1 mb-3">
        {severityBands.map(({ level, threshold }) => {
          const config = severityConfig[level];
          return (
            <div key={level} className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-sm shrink-0"
                style={{
                  background: config.color,
                  boxShadow: `0 0 6px ${config.color}66`,
                }}
              />
              <span className="text-[11px] font-semibold text-text-primary tracking-wide w-[68px]">
                {config.label}
              </span>
              <span className="text-[10px] text-text-muted">{threshold}</span>
            </div>
          );
        })}
      </div>

      {/* Markers */}
      <div className="border-t border-white/8 pt-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3.5 h-3.5 rounded-full shrink-0"
            style={{
              background: "#00d4ff",
              border: "2px solid #00d4ff",
              boxShadow: "0 0 8px rgba(0,212,255,0.5)",
              opacity: 0.85,
            }}
          />
          <span className="text-[10px] text-text-secondary">Glacial lake source</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full shrink-0"
            style={{
              background: "#f59e0b",
              border: "2px solid #f59e0b",
              opacity: 0.85,
            }}
          />
          <span className="text-[10px] text-text-secondary">Downstream village</span>
        </div>
      </div>

      {/* Schematic disclaimer */}
      <div className="border-t border-white/8 mt-2 pt-2">
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className="shrink-0 mt-[2px]"
            style={{
              display: "inline-block",
              width: 14,
              height: 2,
              background:
                "linear-gradient(to right, rgba(148,163,184,0.2), #94a3b8)",
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                right: -1,
                top: -2,
                width: 0,
                height: 0,
                borderLeft: "5px solid #94a3b8",
                borderTop: "3px solid transparent",
                borderBottom: "3px solid transparent",
              }}
            />
          </span>
          <span className="text-[9.5px] text-text-muted leading-snug italic">
            Stylized{" "}
            <span className="text-text-secondary font-semibold not-italic">
              river paths
            </span>{" "}
            — actual valleys may differ.
          </span>
        </div>
      </div>
    </div>
  );
}
