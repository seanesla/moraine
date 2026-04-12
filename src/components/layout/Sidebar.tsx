import { useEffect } from "react";
import { Play, Loader2, Mountain } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useScenarioStore } from "../../stores/scenarioStore";

export default function Sidebar() {
  const { lakes, selectedLakeId, setSelectedLake } = useAppStore();
  const { params, setParam, setAllParams, isRunning, runScenario } =
    useScenarioStore();

  const selectedLake = lakes.find((l) => l.id === selectedLakeId);

  useEffect(() => {
    if (selectedLake) {
      setAllParams({
        lake_volume_m3: selectedLake.volume_m3,
        valley_slope: selectedLake.valley_slope,
        channel_width_m: selectedLake.channel_width_m,
        channel_depth_m: selectedLake.channel_depth_m,
        manning_n: selectedLake.manning_n,
        wave_multiplier: 1.5,
        decay_rate: 0.3,
      });
    }
  }, [selectedLakeId, selectedLake, setAllParams]);

  const handleRun = () => {
    if (selectedLake) runScenario(selectedLake.villages);
  };

  const manningLabel = (n: number) => {
    if (n <= 0.04) return "Smooth";
    if (n <= 0.06) return "Normal";
    if (n <= 0.08) return "Rocky";
    if (n <= 0.10) return "Mountain river";
    return "Debris flow";
  };

  return (
    <div className="w-[280px] min-w-[280px] h-full flex flex-col bg-bg-surface/50 border-r border-border">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* Lake Selector */}
        <Section icon={<Mountain className="w-3.5 h-3.5" />} title="Glacial Lake">
          <select
            value={selectedLakeId ?? ""}
            onChange={(e) => setSelectedLake(e.target.value)}
          >
            {lakes.map((lake) => (
              <option key={lake.id} value={lake.id}>{lake.name}</option>
            ))}
          </select>
          {selectedLake && (
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-text-muted">
              <span>{selectedLake.region}</span>
              <Dot />
              <span>{selectedLake.elevation_m.toLocaleString()}m</span>
              <Dot />
              <span>Risk {selectedLake.risk_rank}</span>
            </div>
          )}
        </Section>

        {/* Parameters */}
        <Section title="Parameters">
          <div className="space-y-4">
            <Field label="Lake Volume" unit="million m³">
              <input
                type="number"
                value={parseFloat((params.lake_volume_m3 / 1e6).toFixed(1))}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) setParam("lake_volume_m3", v * 1e6);
                }}
                step={0.1} min={0.1}
              />
            </Field>

            <Field label="Valley Slope" right={<Mono>{params.valley_slope.toFixed(3)}</Mono>}>
              <input type="range" value={params.valley_slope}
                onChange={(e) => setParam("valley_slope", parseFloat(e.target.value))}
                min={0.005} max={0.15} step={0.005}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Width" unit="m">
                <input type="number" value={params.channel_width_m}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setParam("channel_width_m", v); }}
                  step={1} min={1}
                />
              </Field>
              <Field label="Depth" unit="m">
                <input type="number" value={params.channel_depth_m}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setParam("channel_depth_m", v); }}
                  step={0.5} min={0.5}
                />
              </Field>
            </div>

            <Field label="Manning's n" right={
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted">{manningLabel(params.manning_n)}</span>
                <Mono>{params.manning_n.toFixed(3)}</Mono>
              </div>
            }>
              <input type="range" value={params.manning_n}
                onChange={(e) => setParam("manning_n", parseFloat(e.target.value))}
                min={0.03} max={0.15} step={0.005}
              />
            </Field>
          </div>
        </Section>

        {/* Villages */}
        {selectedLake && (
          <Section title="Downstream" count={selectedLake.villages.length}>
            <div className="space-y-0.5">
              {selectedLake.villages.map((v) => (
                <div key={v.name} className="flex items-center justify-between py-2 px-2.5 rounded-lg hover:bg-white/[0.03] transition-colors">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-text-primary truncate">{v.name}</div>
                    {v.name_nepali && <div className="text-[10px] text-text-muted truncate">{v.name_nepali}</div>}
                  </div>
                  <div className="text-right ml-2.5 shrink-0">
                    <div className="text-[11px] font-mono text-text-secondary">{v.distance_km} km</div>
                    {v.population && <div className="text-[9px] text-text-muted">pop {v.population.toLocaleString()}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Run button */}
      <div className="p-4 border-t border-border">
        <button
          onClick={handleRun}
          disabled={isRunning || !selectedLake}
          className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl font-bold text-sm uppercase tracking-widest transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-br from-red-600 via-orange-600 to-amber-600 border border-red-500/40 text-white hover:-translate-y-[1px] active:translate-y-0 glow-red"
        >
          {isRunning ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Computing...</>
          ) : (
            <><Play className="w-4 h-4 fill-current" /> Run Scenario</>
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Section({ title, icon, count, children }: {
  title: string; icon?: React.ReactNode; count?: number; children: React.ReactNode;
}) {
  return (
    <div className="glass-well p-3.5">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-accent-cyan">{icon}</span>}
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-muted">{title}</span>
        {count !== undefined && (
          <span className="ml-auto text-[9px] font-mono text-text-muted bg-bg-primary/60 px-1.5 py-0.5 rounded-md">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Field({ label, unit, right, children }: {
  label: string; unit?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-text-secondary">{label}</span>
        {unit && <span className="text-[9px] text-text-muted uppercase tracking-wider">{unit}</span>}
        {right}
      </div>
      {children}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px] text-accent-cyan">{children}</span>;
}

function Dot() {
  return <span className="w-px h-2.5 bg-gradient-to-b from-transparent via-white/8 to-transparent" />;
}
