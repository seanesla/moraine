import { useCallback, useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { severityConfig, type SeverityLevel } from "../../lib/severity";
import type { ScenarioResult } from "../../types/scenario";
import type { Lake } from "../../types/lake";
import FloodMapLegend from "./FloodMapLegend";
import VillageMarkers from "./VillageMarkers";
import FloodPlayback from "./FloodPlayback";

interface FloodMapProps {
  result: ScenarioResult;
  lake: Lake;
}

export default function FloodMap({ result, lake }: FloodMapProps) {
  const [impactedNames, setImpactedNames] = useState<Set<string>>(new Set());

  // Reset impacted set whenever the scenario result changes.
  useEffect(() => {
    setImpactedNames(new Set());
  }, [result]);

  const handleImpact = useCallback((name: string) => {
    setImpactedNames((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setImpactedNames(new Set());
  }, []);

  const villageCoords = new Map(
    lake.villages.map((v) => [v.name, { lat: v.lat, lon: v.lon }])
  );

  return (
    <div className="animate-fade-in-up" style={{ animationDelay: "0.6s" }}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
        Flood Impact Map
      </h3>
      <div
        className="relative rounded-xl border border-border overflow-hidden"
        style={{ height: 400 }}
      >
        <MapContainer
          center={[lake.lat, lake.lon]}
          zoom={10}
          style={{ height: "100%", width: "100%", background: "#060610" }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />

          {/* Lake marker */}
          <CircleMarker
            center={[lake.lat, lake.lon]}
            radius={12}
            pathOptions={{
              color: "#00d4ff",
              fillColor: "#00d4ff",
              fillOpacity: 0.6,
              weight: 2,
            }}
          >
            <Popup>
              <div style={{ color: "#0c0c1d", fontWeight: 600 }}>
                {lake.name}
                <br />
                <span style={{ fontWeight: 400, fontSize: 11 }}>
                  {lake.elevation_m.toLocaleString()}m elevation
                </span>
              </div>
            </Popup>
          </CircleMarker>

          {/* Straight downstream-distance polylines (schematic) */}
          {result.villages.map((village) => {
            const coords = villageCoords.get(village.name);
            if (!coords?.lat || !coords?.lon) return null;
            const config = severityConfig[village.severity as SeverityLevel];
            return (
              <Polyline
                key={`line-${village.name}`}
                positions={[
                  [lake.lat, lake.lon],
                  [coords.lat, coords.lon],
                ]}
                pathOptions={{
                  color: config.color,
                  weight: 2.5,
                  opacity: 0.7,
                }}
              />
            );
          })}

          {/* Village markers with pulse on impact */}
          <VillageMarkers
            result={result}
            lake={lake}
            impactedNames={impactedNames}
          />

          {/* Playback controls + animation (uses useMap) */}
          <FloodPlayback
            result={result}
            lake={lake}
            onImpact={handleImpact}
            onReset={handleReset}
          />

          <FitBounds lake={lake} />
        </MapContainer>

        {/* Legend overlay — OUTSIDE MapContainer but inside wrapper for z-index */}
        <FloodMapLegend />
      </div>
    </div>
  );
}

function FitBounds({ lake }: { lake: Lake }) {
  const map = useMap();

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

  return null;
}
