import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./map-v2.css";
import type { ScenarioResult } from "../../../types/scenario";
import type { Lake } from "../../../types/lake";
import FloodMapLegend from "../FloodMapLegend";
import LakeIcon from "./LakeIcon";
import VillageIconV2, { type VillageIconState } from "./VillageIconV2";
import VillageCalloutPanel from "./VillageCalloutPanel";
import RiverPaths from "./RiverPaths";
import FloodShaderCanvas, {
  type FloodShaderHandle,
} from "./shaders/FloodShaderCanvas";
import CameraDirector from "./CameraDirector";
import HillshadeLayer from "./HillshadeLayer";
import HudOverlay from "./HudOverlay";
import {
  useFloodChoreography,
  type ChoreographyRefs,
  type HudState,
  type VillageState,
} from "./useFloodChoreography";
import type { LatLon } from "./lib/arcLength";

interface FloodMapV2Props {
  result: ScenarioResult;
  lake: Lake;
  mode?: "compact" | "expanded";
  onExpandClick?: () => void;
}

const INITIAL_HUD: HudState = {
  phase: "idle",
  modelTimeSec: 0,
  villagesHit: 0,
  modelSeconds: 0,
  playbackSeconds: 8,
};

export default function FloodMapV2({
  result,
  lake,
  mode = "expanded",
  onExpandClick,
}: FloodMapV2Props) {
  const isCompact = mode === "compact";

  // Hot-path refs (owned here, passed down into the choreography hook).
  const shaderHandleRef = useRef<FloodShaderHandle | null>(null);
  const villageStateRef = useRef<Map<string, VillageState>>(new Map());
  const villageLatLngRef = useRef<Map<string, LatLon>>(new Map());
  const hudStateRef = useRef<HudState>({ ...INITIAL_HUD });

  const choreographyRefs = useMemo<ChoreographyRefs>(
    () => ({
      shaderHandleRef,
      villageStateRef,
      villageLatLngRef,
      hudStateRef,
    }),
    [],
  );

  const villageCoords = useMemo(
    () => new Map(lake.villages.map((v) => [v.name, { lat: v.lat, lon: v.lon }])),
    [lake],
  );

  // Keep the lookup used by triggerImpactAt in sync whenever the lake
  // changes. The ref is read inside a gsap tl.call, so we want a stable
  // Map instance that we mutate in place.
  useEffect(() => {
    villageLatLngRef.current.clear();
    for (const v of lake.villages) {
      if (v.lat != null && v.lon != null) {
        villageLatLngRef.current.set(v.name, [v.lat, v.lon] as LatLon);
      }
    }
  }, [lake]);

  // Farthest village that has a real DEM-traced river_path. The shader
  // walks this polyline at constant ground speed (arc-length parameter-
  // ization), so the wave reaches each upstream village at the right
  // model time. If no village has a path we render nothing for the
  // shader — the lake markers and HUD still work.
  const farthest = useMemo<
    { path: LatLon[]; distanceKm: number } | null
  >(() => {
    const villageByName = new Map(lake.villages.map((v) => [v.name, v]));
    let best: { path: LatLon[]; distanceKm: number } | null = null;
    let bestDist = -1;
    for (const v of result.villages) {
      const lakeVillage = villageByName.get(v.name);
      const path = lakeVillage?.river_path;
      if (!path || path.length < 2) continue;
      if (v.distance_km > bestDist) {
        bestDist = v.distance_km;
        best = {
          path: path as LatLon[],
          distanceKm: v.distance_km,
        };
      }
    }
    return best;
  }, [result, lake]);

  // Memoized so the FloodShaderCanvas doesn't see a new array reference
  // every parent re-render. The effect deps still use the primitive
  // components, but the prop closure inside `syncPositions` now captures
  // a stable reference.
  const lakeLatLng = useMemo<LatLon>(
    () => [lake.lat, lake.lon],
    [lake.lat, lake.lon],
  );

  // Wide-framing bounds for the aftermath camera move. Same math as the
  // one-shot FitBounds below — computed once per lake.
  const wideBounds = useMemo<[[number, number], [number, number]] | null>(() => {
    const lats = [
      lake.lat,
      ...lake.villages.filter((v) => v.lat != null).map((v) => v.lat!),
    ];
    const lons = [
      lake.lon,
      ...lake.villages.filter((v) => v.lon != null).map((v) => v.lon!),
    ];
    if (lats.length < 2) return null;
    return [
      [Math.min(...lats) - 0.05, Math.min(...lons) - 0.05],
      [Math.max(...lats) + 0.05, Math.max(...lons) + 0.05],
    ];
  }, [lake]);

  const { play, pause, reset, isPlaying, plan } = useFloodChoreography(
    result,
    lake,
    choreographyRefs,
  );

  // Read current village states into a Map we can hand down as a prop.
  // `plan` is updated whenever the hook rebuilds the timeline — we use it
  // as a shallow "scenario changed" signal. `isPlaying` + the hook's
  // internal bump reducer cover the per-tick reads via React's natural
  // re-render on state-set, but village state and hud live in refs for
  // the hot path.
  const villageStatesForRender = new Map<string, VillageIconState>();
  for (const v of result.villages) {
    villageStatesForRender.set(
      v.name,
      (villageStateRef.current.get(v.name) ?? "idle") as VillageIconState,
    );
  }

  const currentPhase = hudStateRef.current.phase;

  return (
    <div
      className={isCompact ? "animate-fade-in-up" : "h-full"}
      style={isCompact ? { animationDelay: "0.6s" } : undefined}
    >
      {isCompact && (
        <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
          Flood Impact Map
        </h3>
      )}
      <div
        className={`v2-map-frame relative rounded-xl border border-border overflow-hidden ${
          isCompact ? "v2-compact-wrapper" : ""
        }`}
        style={{ height: isCompact ? 400 : "100%" }}
        onClick={isCompact && onExpandClick ? onExpandClick : undefined}
        role={isCompact && onExpandClick ? "button" : undefined}
        tabIndex={isCompact && onExpandClick ? 0 : undefined}
        onKeyDown={
          isCompact && onExpandClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onExpandClick();
                }
              }
            : undefined
        }
        aria-label={isCompact ? "Click to open full flood impact map" : undefined}
      >
        <MapContainer
          center={[lake.lat, lake.lon]}
          zoom={10}
          style={{ height: "100%", width: "100%", background: "#060610" }}
          zoomControl={false}
          attributionControl={false}
          dragging={!isCompact}
          scrollWheelZoom={!isCompact}
          doubleClickZoom={!isCompact}
          touchZoom={!isCompact}
          boxZoom={!isCompact}
          keyboard={!isCompact}
        >
          <HillshadeLayer lake={lake} />
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            className="map-blend-multiply"
          />

          <RiverPaths result={result} lake={lake} />

          <LakeIcon lake={lake} showPopup={!isCompact} />

          {result.villages.map((village) => {
            const coords = villageCoords.get(village.name);
            if (!coords?.lat || !coords?.lon) return null;
            return (
              <VillageIconV2
                key={`${lake.id}-${village.name}`}
                village={village}
                lat={coords.lat}
                lon={coords.lon}
                state={villageStatesForRender.get(village.name) ?? "idle"}
                showPopup={!isCompact}
              />
            );
          })}

          {!isCompact && farthest && (
            <FloodShaderCanvas
              ref={shaderHandleRef}
              lakeLatLng={lakeLatLng}
              farthestPath={farthest.path}
              maxDistanceKm={farthest.distanceKm}
            />
          )}

          <CameraDirector
            phase={currentPhase}
            lake={lake}
            wideBounds={wideBounds}
            isPlaying={isPlaying}
          />

          <FitBounds lake={lake} />
        </MapContainer>

        {!isCompact && (
          <HudOverlay
            lake={lake}
            result={result}
            phase={currentPhase}
            isPlaying={isPlaying}
            hudStateRef={hudStateRef}
          />
        )}

        {!isCompact && (
          <ControlPanel
            isPlaying={isPlaying}
            hasPlan={plan != null && plan.villages.length > 0}
            onPlay={play}
            onPause={pause}
            onReset={reset}
          />
        )}

        {!isCompact && <FloodMapLegend />}

        {!isCompact && (
          <VillageCalloutPanel
            villages={result.villages}
            villageStates={villageStatesForRender}
          />
        )}

        {isCompact && onExpandClick && (
          <button
            type="button"
            className="v2-expand-button"
            onClick={(e) => {
              e.stopPropagation();
              onExpandClick();
            }}
            aria-label="Expand flood map"
          >
            <span className="v2-expand-icon" aria-hidden>
              ⤢
            </span>
            <span>Expand</span>
          </button>
        )}

        {isCompact && (
          <div className="v2-compact-hint" aria-hidden>
            Click to view full simulation
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * FitBounds runs once per lake change. We gate on `lake.id` rather than
 * deps that include `villages` so the CameraDirector's flyTo calls during
 * playback don't cause an unwanted snap-back.
 */
function FitBounds({ lake }: { lake: Lake }) {
  const map = useMap();

  useEffect(() => {
    const allLats = [
      lake.lat,
      ...lake.villages.filter((v) => v.lat).map((v) => v.lat!),
    ];
    const allLons = [
      lake.lon,
      ...lake.villages.filter((v) => v.lon).map((v) => v.lon!),
    ];

    if (allLats.length > 1) {
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...allLats) - 0.05, Math.min(...allLons) - 0.05],
        [Math.max(...allLats) + 0.05, Math.max(...allLons) + 0.05],
      ];
      map.fitBounds(bounds, { padding: [30, 30] });
    }
    // Re-fit only when the lake itself changes (id). Intentionally omit
    // `map` — that ref is stable across renders and adding it would force
    // a fit whenever Leaflet internals churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lake.id]);

  return null;
}

interface ControlPanelProps {
  isPlaying: boolean;
  hasPlan: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
}

function ControlPanel({
  isPlaying,
  hasPlan,
  onPlay,
  onPause,
  onReset,
}: ControlPanelProps) {
  return (
    <div className="v2-control-panel">
      {isPlaying ? (
        <button
          type="button"
          className="v2-control-button"
          onClick={onPause}
          disabled={!hasPlan}
        >
          Pause
        </button>
      ) : (
        <button
          type="button"
          className="v2-control-button v2-control-button-primary"
          onClick={onPlay}
          disabled={!hasPlan}
        >
          Play
        </button>
      )}
      <button
        type="button"
        className="v2-control-button"
        onClick={onReset}
        disabled={!hasPlan}
      >
        Reset
      </button>
    </div>
  );
}
