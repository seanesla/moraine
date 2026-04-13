import { useState } from "react";
import ResultsHero from "./ResultsHero";
import ExplainPanel from "./ExplainPanel";
import CountdownGrid from "./CountdownGrid";
import ArrivalChart from "./ArrivalChart";
import FloodMapV2 from "../map/v2/FloodMapV2";
import FloodMapModal from "../map/v2/FloodMapModal";
import type { ScenarioResult } from "../../types/scenario";
import type { Lake } from "../../types/lake";

interface ResultsDashboardProps {
  result: ScenarioResult;
  lake: Lake;
}

export default function ResultsDashboard({ result, lake }: ResultsDashboardProps) {
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="space-y-6 w-full">
      <ResultsHero result={result} />
      <ExplainPanel result={result} lake={lake} />
      <CountdownGrid villages={result.villages} />
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-6">
        <ArrivalChart villages={result.villages} />
        <FloodMapV2
          result={result}
          lake={lake}
          mode="compact"
          onExpandClick={() => setMapOpen(true)}
        />
      </div>
      <FloodMapModal
        isOpen={mapOpen}
        onClose={() => setMapOpen(false)}
        result={result}
        lake={lake}
      />
    </div>
  );
}
