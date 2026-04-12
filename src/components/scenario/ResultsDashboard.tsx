import ResultsHero from "./ResultsHero";
import CountdownGrid from "./CountdownGrid";
import ArrivalChart from "./ArrivalChart";
import FloodMap from "../map/FloodMap";
import type { ScenarioResult } from "../../types/scenario";
import type { Lake } from "../../types/lake";

interface ResultsDashboardProps {
  result: ScenarioResult;
  lake: Lake;
}

export default function ResultsDashboard({ result, lake }: ResultsDashboardProps) {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <ResultsHero result={result} />
      <CountdownGrid villages={result.villages} />
      <div className="grid grid-cols-2 gap-6">
        <ArrivalChart villages={result.villages} />
        <FloodMap result={result} lake={lake} />
      </div>
    </div>
  );
}
