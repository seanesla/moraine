import { Fragment, useEffect, useState } from "react";
import { CircleMarker, Popup } from "react-leaflet";
import { severityConfig, type SeverityLevel } from "../../lib/severity";
import { formatMinutes } from "../../lib/formatters";
import type { ScenarioResult, VillageResult } from "../../types/scenario";
import type { Lake } from "../../types/lake";

interface VillageMarkersProps {
  result: ScenarioResult;
  lake: Lake;
  impactedNames: Set<string>;
}

interface PulseRingProps {
  center: [number, number];
  color: string;
}

function PulseRing({ center, color }: PulseRingProps) {
  // 600ms imperative pulse: radius grows 9 -> 26, opacity fades 0.6 -> 0
  const frames = 12;
  const stepMs = 50;
  const [frame, setFrame] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      setFrame((f) => {
        if (f + 1 >= frames) {
          clearInterval(id);
          setDone(true);
          return frames;
        }
        return f + 1;
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [done]);

  if (done) return null;
  const t = frame / frames;
  const radius = 9 + 17 * t;
  const opacity = 0.55 * (1 - t);

  return (
    <CircleMarker
      center={center}
      radius={radius}
      pathOptions={{
        color,
        fillColor: color,
        fillOpacity: 0,
        weight: 2,
        opacity,
      }}
      interactive={false}
    />
  );
}

export default function VillageMarkers({
  result,
  lake,
  impactedNames,
}: VillageMarkersProps) {
  const villageCoords = new Map(
    lake.villages.map((v) => [v.name, { lat: v.lat, lon: v.lon }])
  );

  return (
    <>
      {result.villages.map((village: VillageResult) => {
        const coords = villageCoords.get(village.name);
        if (!coords?.lat || !coords?.lon) return null;

        const config = severityConfig[village.severity as SeverityLevel];
        const isImpacted = impactedNames.has(village.name);
        const center: [number, number] = [coords.lat, coords.lon];

        return (
          <Fragment key={village.name}>
            {isImpacted && <PulseRing center={center} color={config.color} />}
            <CircleMarker
              center={center}
              radius={9}
              pathOptions={{
                color: config.color,
                fillColor: config.color,
                fillOpacity: isImpacted ? 0.95 : 0.7,
                weight: isImpacted ? 3 : 2,
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
          </Fragment>
        );
      })}
    </>
  );
}
