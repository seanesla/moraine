import { useEffect } from "react";
import { Play, Loader2 } from "lucide-react";
import GlassCard from "../common/GlassCard";
import { useAppStore } from "../../stores/appStore";
import { usePackStore, useActiveLakes } from "../../stores/packStore";
import { useScenarioStore } from "../../stores/scenarioStore";

export default function Sidebar() {
  const selectedLakeId = useAppStore((s) => s.selectedLakeId);
  const setSelectedLake = useAppStore((s) => s.setSelectedLake);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const packs = usePackStore((s) => s.packs);
  const activeRegionIds = usePackStore((s) => s.activeRegionIds);
  const activeLakes = useActiveLakes();
  const { params, setParam, setAllParams, isRunning, runScenario, clearResult } = useScenarioStore();
  const selectedLake = activeLakes.find((l) => l.id === selectedLakeId);

  // If the currently selected lake gets filtered out (its region was toggled
  // off), snap selection to the first visible lake so the UI stays coherent.
  // If ALL regions are toggled off, clear the selection AND the cached
  // scenario result so the dashboard doesn't keep rendering a now-hidden
  // lake (DA #15 finding).
  useEffect(() => {
    if (activeLakes.length === 0) {
      if (selectedLakeId !== null) {
        setSelectedLake(null);
        clearResult();
      }
      return;
    }
    if (!selectedLakeId || !activeLakes.some((l) => l.id === selectedLakeId)) {
      setSelectedLake(activeLakes[0].id);
    }
  }, [activeLakes, selectedLakeId, setSelectedLake, clearResult]);

  const activeRegionCount = activeRegionIds.length;
  const totalRegionCount = packs.length;
  // Only show the "no active regions" empty state when there actually ARE
  // installed packs but the user has toggled them all off. If the backend
  // hasn't served any packs at all, fall through to the normal lake list
  // (degraded mode — better than locking the user out).
  const showRegionEmptyState = totalRegionCount > 0 && activeRegionCount === 0;

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
      // Clear any stale results from a previously-selected lake
      clearResult();
    }
  }, [selectedLakeId, selectedLake, setAllParams, clearResult]);

  const handleRun = () => { if (selectedLake) runScenario(selectedLake.villages); };

  const manningDesc = (n: number) =>
    n <= 0.04 ? "Smooth" : n <= 0.06 ? "Normal" : n <= 0.08 ? "Rocky" : n <= 0.1 ? "Mountain" : "Debris";

  return (
    <aside className="flex w-[240px] flex-col py-4 px-3 gap-3 overflow-y-auto
      my-3 ml-3 rounded-2xl
      bg-[rgba(9,9,11,0.55)] backdrop-blur-[16px] backdrop-saturate-[1.2]
      border border-white/[0.07]
      shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)]
      transition-all duration-500 ease-out
      hover:scale-[1.015] hover:bg-[rgba(9,9,11,0.7)]
      hover:border-white/[0.14]
      hover:shadow-[0_16px_48px_-8px_rgba(0,0,0,0.7),0_0_40px_-14px_var(--color-glow-primary)]">

      {/* Lake selector */}
      <GlassCard variant="dense" hover={false} className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionLabel>Lake</SectionLabel>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-[9px] uppercase tracking-[0.1em] text-text-muted/80 hover:text-primary transition-colors duration-150 cursor-pointer"
          >
            Manage
          </button>
        </div>
        {showRegionEmptyState ? (
          <div className="text-[11px] text-text-muted leading-snug py-1">
            No active regions — enable one in{" "}
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-primary hover:underline cursor-pointer"
            >
              settings
            </button>
            .
          </div>
        ) : (
          <>
            <select value={selectedLakeId ?? ""} onChange={(e) => setSelectedLake(e.target.value)}>
              {activeLakes.length === 0 && <option value="">Loading...</option>}
              {activeLakes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {totalRegionCount > 0 && (
              <span className="text-[10px] text-text-muted leading-snug">
                {activeLakes.length} lake{activeLakes.length === 1 ? "" : "s"} from {activeRegionCount} of {totalRegionCount} region{totalRegionCount === 1 ? "" : "s"}
              </span>
            )}
            {selectedLake && (
              <span className="text-[10px] text-text-muted leading-snug">
                {selectedLake.region} · {selectedLake.elevation_m.toLocaleString()}m · Risk {selectedLake.risk_rank}
              </span>
            )}
          </>
        )}
      </GlassCard>

      {/* Parameters */}
      <GlassCard variant="dense" hover={false} className="p-4 flex flex-col gap-4">
        <SectionLabel>Parameters</SectionLabel>

        <Field label="Volume" unit="M m³">
          <input type="number" value={parseFloat((params.lake_volume_m3 / 1e6).toFixed(1))}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setParam("lake_volume_m3", v * 1e6); }}
            step={0.1} min={0.1} />
        </Field>

        <Field label="Slope" right={<Cyan>{params.valley_slope.toFixed(3)}</Cyan>}>
          <input type="range" value={params.valley_slope}
            onChange={(e) => setParam("valley_slope", parseFloat(e.target.value))}
            min={0.005} max={0.15} step={0.005} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Width" unit="m">
            <input type="number" value={params.channel_width_m}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setParam("channel_width_m", v); }}
              step={1} min={1} />
          </Field>
          <Field label="Depth" unit="m">
            <input type="number" value={params.channel_depth_m}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setParam("channel_depth_m", v); }}
              step={0.5} min={0.5} />
          </Field>
        </div>

        <Field label="Manning's n" right={<span className="text-text-muted text-[10px]">{manningDesc(params.manning_n)} <Cyan>{params.manning_n.toFixed(3)}</Cyan></span>}>
          <input type="range" value={params.manning_n}
            onChange={(e) => setParam("manning_n", parseFloat(e.target.value))}
            min={0.03} max={0.15} step={0.005} />
        </Field>
      </GlassCard>

      {/* Villages */}
      {selectedLake && selectedLake.villages.length > 0 && (
        <GlassCard variant="well" hover={false} className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <SectionLabel>Villages</SectionLabel>
            <span className="text-[10px] text-text-muted">{selectedLake.villages.length}</span>
          </div>
          {selectedLake.villages.map((v) => (
            <div key={v.name} className="flex items-center justify-between text-[12px] py-1">
              <div className="truncate mr-2">
                <span className="text-text-primary font-medium">{v.name}</span>
                {v.name_nepali && <span className="text-text-muted text-[10px] ml-1">{v.name_nepali}</span>}
              </div>
              <span className="font-mono text-[11px] text-text-muted shrink-0">{v.distance_km}km</span>
            </div>
          ))}
        </GlassCard>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Run button */}
      <button onClick={handleRun} disabled={isRunning || !selectedLake}
        className="w-full flex items-center justify-center gap-2 h-10 rounded-lg font-semibold text-sm tracking-wide transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-br from-primary via-primary to-primary-hover text-white border border-primary/55 shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_12px_32px_-14px_var(--color-glow-primary)] hover:-translate-y-[1px] hover:shadow-[0_1px_0_rgba(255,255,255,0.32)_inset,0_18px_38px_-12px_var(--color-glow-primary)] active:translate-y-0"
      >
        {isRunning ? <><Loader2 className="w-4 h-4 animate-spin" />Running...</>
          : <><Play className="w-4 h-4 fill-current" />Run Scenario</>}
      </button>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{children}</span>;
}

function Field({ label, unit, right, children }: {
  label: string; unit?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-text-secondary">{label}</span>
        {unit && <span className="text-[9px] text-text-muted uppercase">{unit}</span>}
        {right}
      </div>
      {children}
    </div>
  );
}

function Cyan({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] text-primary">{children}</span>;
}
