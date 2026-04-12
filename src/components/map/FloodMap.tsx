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
import { formatMinutes } from "../../lib/formatters";
import type { ScenarioResult } from "../../types/scenario";
import type { Lake } from "../../types/lake";

interface FloodMapProps {
  result: ScenarioResult;
  lake: Lake;
}

export default function FloodMap({ result, lake }: FloodMapProps) {
  const villageCoords = new Map(
    lake.villages.map((v) => [v.name, { lat: v.lat, lon: v.lon }])
  );

  return (
    <div className="animate-fade-in-up" style={{ animationDelay: "0.6s" }}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
        Flood Impact Map
      </h3>
      <div
        className="rounded-xl border border-border overflow-hidden"
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

          {/* Village markers + lines */}
          {result.villages.map((village) => {
            const coords = villageCoords.get(village.name);
            if (!coords?.lat || !coords?.lon) return null;

            const config = severityConfig[village.severity as SeverityLevel];
            const popSize = village.population
              ? Math.min(Math.max(6, Math.sqrt(village.population) / 2), 16)
              : 8;

            return (
              <div key={village.name}>
                <Polyline
                  positions={[
                    [lake.lat, lake.lon],
                    [coords.lat, coords.lon],
                  ]}
                  pathOptions={{
                    color: config.color,
                    weight: 1.5,
                    opacity: 0.4,
                    dashArray: "6 4",
                  }}
                />
                <CircleMarker
                  center={[coords.lat, coords.lon]}
                  radius={popSize}
                  pathOptions={{
                    color: config.color,
                    fillColor: config.color,
                    fillOpacity: 0.7,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <div style={{ color: "#0c0c1d", fontSize: 12 }}>
                      <strong>{village.name}</strong>
                      {village.name_nepali && (
                        <span style={{ fontWeight: 400 }}>
                          {" "}
                          ({village.name_nepali})
                        </span>
                      )}
                      <br />
                      Arrival:{" "}
                      <strong>{formatMinutes(village.arrival_time_min)}</strong>
                      <br />
                      Severity: <strong>{village.severity}</strong>
                      {village.population && (
                        <>
                          <br />
                          Population: {village.population.toLocaleString()}
                        </>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              </div>
            );
          })}

          <FitBounds lake={lake} />
        </MapContainer>
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
