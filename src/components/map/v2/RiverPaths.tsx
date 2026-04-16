import { Fragment } from "react";
import { Polyline } from "react-leaflet";
import { severityConfig, type SeverityLevel } from "../../../lib/severity";
import type { ScenarioResult } from "../../../types/scenario";
import type { Lake } from "../../../types/lake";

interface RiverPathsProps {
  result: ScenarioResult;
  lake: Lake;
}

export default function RiverPaths({ result, lake }: RiverPathsProps) {
  const villageByName = new Map(lake.villages.map((v) => [v.name, v]));

  return (
    <>
      {result.villages.map((village) => {
        const lakeVillage = villageByName.get(village.name);
        const path = lakeVillage?.river_path;
        if (!path || path.length < 2) return null;

        const config = severityConfig[village.severity as SeverityLevel];
        if (!config) return null;
        return (
          <Fragment key={`river-${village.name}`}>
            <Polyline
              positions={path}
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
              positions={path}
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
