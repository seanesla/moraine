import { useCallback, useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { Play, Pause, RotateCcw } from "lucide-react";
import type { ScenarioResult } from "../../types/scenario";
import type { Lake } from "../../types/lake";

/**
 * Ref callback: stop Leaflet from treating clicks/scrolls on this element
 * as map drags or zooms. Applied to the absolute-positioned control panel.
 */
function stopLeafletPropagation(el: HTMLDivElement | null) {
  if (!el) return;
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
}

interface VillageTarget {
  name: string;
  lat: number;
  lon: number;
  fraction: number; // 0..1 along lake -> farthest village line
}

const DURATION_MS = 10_000; // fixed cinematic duration

function buildTargets(
  result: ScenarioResult,
  lake: Lake
): { targets: VillageTarget[]; farthest: VillageTarget | null } {
  const coordsByName = new Map(
    lake.villages.map((v) => [v.name, { lat: v.lat, lon: v.lon }])
  );

  const raw = result.villages
    .map((v) => {
      const c = coordsByName.get(v.name);
      if (!c?.lat || !c?.lon) return null;
      return {
        name: v.name,
        lat: c.lat,
        lon: c.lon,
        distance_km: v.distance_km,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.distance_km - b.distance_km);

  if (raw.length === 0) return { targets: [], farthest: null };
  const maxDist = raw[raw.length - 1].distance_km || 1;

  const targets: VillageTarget[] = raw.map((t) => ({
    name: t.name,
    lat: t.lat,
    lon: t.lon,
    fraction: t.distance_km / maxDist,
  }));

  return { targets, farthest: targets[targets.length - 1] };
}

/**
 * Imperative RAF-driven marker animator. Lives INSIDE <MapContainer>
 * because it needs `useMap()`. Exposes start/stop via the `trigger`
 * ref-like prop: when `trigger` flips to a new number, playback starts.
 */
interface PlaybackLayerProps {
  result: ScenarioResult;
  lake: Lake;
  trigger: number; // increments to start playback
  onImpact: (name: string) => void;
  onComplete: () => void;
  stopSignal: number; // increments to stop playback
}

function PlaybackLayer({
  result,
  lake,
  trigger,
  onImpact,
  onComplete,
  stopSignal,
}: PlaybackLayerProps) {
  const map = useMap();
  const markerRef = useRef<L.CircleMarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const impactedRef = useRef<Set<string>>(new Set());
  const onImpactRef = useRef(onImpact);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onImpactRef.current = onImpact;
    onCompleteRef.current = onComplete;
  }, [onImpact, onComplete]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, []);

  // Stop on unmount or when result/lake changes.
  useEffect(() => {
    return () => stop();
  }, [result, lake, stop]);

  // Stop when parent flips stopSignal.
  useEffect(() => {
    if (stopSignal === 0) return;
    stop();
    impactedRef.current = new Set();
  }, [stopSignal, stop]);

  // Start playback when trigger flips.
  useEffect(() => {
    if (trigger === 0) return;

    const { targets, farthest } = buildTargets(result, lake);
    if (!farthest) return;

    impactedRef.current = new Set();

    if (markerRef.current) {
      markerRef.current.remove();
    }
    markerRef.current = L.circleMarker([lake.lat, lake.lon], {
      radius: 9,
      color: "#00d4ff",
      fillColor: "#00d4ff",
      fillOpacity: 0.95,
      weight: 3,
      className: "flood-playback-marker",
    }).addTo(map);

    const startTime = performance.now();

    const tick = (now: number) => {
      if (!markerRef.current) return;
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / DURATION_MS);

      const lat = lake.lat + (farthest.lat - lake.lat) * t;
      const lon = lake.lon + (farthest.lon - lake.lon) * t;
      markerRef.current.setLatLng([lat, lon]);

      for (const target of targets) {
        if (t >= target.fraction && !impactedRef.current.has(target.name)) {
          impactedRef.current.add(target.name);
          onImpactRef.current(target.name);
        }
      }

      if (t >= 1) {
        rafRef.current = null;
        onCompleteRef.current();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    // Intentionally only react to trigger — result/lake use current refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return null;
}

interface FloodPlaybackProps {
  result: ScenarioResult;
  lake: Lake;
  onImpact: (villageName: string) => void;
  onReset: () => void;
}

/**
 * Public component: renders the play/reset button (absolute-positioned
 * in the map wrapper) AND a hidden PlaybackLayer child that must live
 * inside <MapContainer>. To keep the public API simple (`<FloodPlayback>`
 * used in one place), the button gets portaled via absolute div in the
 * wrapper — but since this component is rendered inside <MapContainer>
 * by FloodMap, we return BOTH the UI div and the PlaybackLayer.
 *
 * NOTE: FloodMap renders <FloodPlayback> inside MapContainer so useMap()
 * works. The <div> button is absolute positioned relative to the nearest
 * positioned ancestor (the map wrapper), which is correct.
 */
export default function FloodPlayback({
  result,
  lake,
  onImpact,
  onReset,
}: FloodPlaybackProps) {
  const [playing, setPlaying] = useState(false);
  const [trigger, setTrigger] = useState(0);
  const [stopSignal, setStopSignal] = useState(0);

  // Stop if scenario changes.
  useEffect(() => {
    setPlaying(false);
    setStopSignal((s) => s + 1);
  }, [result, lake]);

  const handlePlay = () => {
    if (playing) {
      setPlaying(false);
      setStopSignal((s) => s + 1);
      return;
    }
    onReset();
    setPlaying(true);
    setTrigger((t) => t + 1);
  };

  const handleReset = () => {
    setPlaying(false);
    setStopSignal((s) => s + 1);
    onReset();
  };

  const handleComplete = () => {
    setPlaying(false);
  };

  return (
    <>
      <PlaybackLayer
        result={result}
        lake={lake}
        trigger={trigger}
        stopSignal={stopSignal}
        onImpact={onImpact}
        onComplete={handleComplete}
      />
      <div
        ref={stopLeafletPropagation}
        className="absolute right-3 top-3 z-[800] pointer-events-auto flex items-center gap-2"
        style={{
          background: "rgba(17, 17, 19, 0.82)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          padding: "6px 8px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        }}
      >
        <button
          onClick={handlePlay}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors hover:bg-white/8"
          style={{
            background: playing ? "rgba(0,212,255,0.15)" : "transparent",
            border: "1px solid rgba(0,212,255,0.35)",
            color: "#00d4ff",
          }}
          aria-label={playing ? "Pause flood playback" : "Play flood"}
        >
          {playing ? (
            <>
              <Pause className="w-3 h-3" />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play className="w-3 h-3" />
              <span>Play the flood</span>
            </>
          )}
        </button>
        <button
          onClick={handleReset}
          className="flex items-center justify-center w-6 h-6 rounded-md text-text-muted hover:text-text-primary hover:bg-white/8 transition-colors"
          aria-label="Reset playback"
          title="Reset playback"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>
    </>
  );
}
