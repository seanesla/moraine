import { Fragment } from "react";
import { Polyline } from "react-leaflet";
import { severityConfig, type SeverityLevel } from "../../../lib/severity";
import type { ScenarioResult } from "../../../types/scenario";
import type { Lake } from "../../../types/lake";
import { quadraticBezierPoints } from "./lib/curves";

interface RiverPathsProps {
  result: ScenarioResult;
  lake: Lake;
}

const CURVATURE = 0.22;

export default function RiverPaths({ result, lake }: RiverPathsProps) {
  const villageCoords = new Map(
    lake.villages.map((v) => [v.name, { lat: v.lat, lon: v.lon }]),
  );

  return (
    <>
      {result.villages.map((village, index) => {
        const coords = villageCoords.get(village.name);
        if (!coords?.lat || !coords?.lon) return null;

        const config = severityConfig[village.severity as SeverityLevel];
        // Alternate by index to guarantee ≥2-village lakes never curve all
        // the same direction — a hash alone clusters on small-vocabulary
        // village-name sets (mono-sided for 6/25 packs). See Phase 1 review.
        const side: -1 | 1 = index % 2 === 0 ? 1 : -1;
        const points = quadraticBezierPoints(
          [lake.lat, lake.lon],
          [coords.lat, coords.lon],
          CURVATURE,
          side,
          32,
        );

        return (
          <Fragment key={`river-${village.name}`}>
            <Polyline
              positions={points}
              pathOptions={{
                color: config.color,
                weight: 9,
                opacity: 0.18,
                lineCap: "round",
                lineJoin: "round",
              }}
              interactive={false}
            />
            <Polyline
              positions={points}
              pathOptions={{
                color: config.color,
                weight: 2.5,
                opacity: 0.85,
                lineCap: "round",
                lineJoin: "round",
              }}
              interactive={false}
            />
          </Fragment>
        );
      })}
    </>
  );
}
