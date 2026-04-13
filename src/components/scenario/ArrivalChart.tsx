import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ErrorBar,
  Cell,
  ReferenceLine,
} from "recharts";
import { severityConfig, type SeverityLevel } from "../../lib/severity";
import type { VillageResult } from "../../types/scenario";

interface ArrivalChartProps {
  villages: VillageResult[];
}

interface ArrivalDatum {
  name: string;
  time: number;
  low: number;
  high: number;
  rawLow: number;
  rawHigh: number;
  severity: VillageResult["severity"];
}

interface TooltipPayloadItem {
  payload: ArrivalDatum;
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0].payload;
  const best = datum.time.toFixed(1);
  const low = datum.rawLow.toFixed(1);
  const high = datum.rawHigh.toFixed(1);
  return (
    <div
      style={{
        backgroundColor: "rgba(17, 17, 19, 0.95)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          color: "#fafafa",
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ color: "#cbd5e1", fontSize: 12 }}>
        {best} min{" "}
        <span style={{ color: "#94a3b8" }}>
          ({low}–{high} range)
        </span>
      </div>
    </div>
  );
}

export default function ArrivalChart({ villages }: ArrivalChartProps) {
  const data: ArrivalDatum[] = villages.map((v) => ({
    name: v.name,
    time: v.arrival_time_min,
    low: v.arrival_time_min - v.arrival_time_low_min,
    high: v.arrival_time_high_min - v.arrival_time_min,
    rawLow: v.arrival_time_low_min,
    rawHigh: v.arrival_time_high_min,
    severity: v.severity,
  }));

  return (
    <div className="animate-fade-in-up" style={{ animationDelay: "0.5s" }}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-1">
        Arrival Time Comparison
      </h3>
      <p className="text-[11px] italic text-text-muted mb-3 leading-snug">
        Bar = best-estimate arrival. Whisker = range from 1.3× (slow) to 1.7×
        (fast) wave-speed uncertainty.
      </p>
      <div className="rounded-xl border border-border bg-bg-tertiary/30 p-4">
        <ResponsiveContainer width="100%" height={Math.max(200, villages.length * 55)}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.04)"
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fill: "#565a72", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              label={{
                value: "Minutes",
                position: "insideBottomRight",
                offset: -5,
                fill: "#565a72",
                fontSize: 10,
              }}
            />
            <YAxis
              dataKey="name"
              type="category"
              tick={{ fill: "#8b8fa8", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={100}
            />
            <ReferenceLine
              x={0}
              stroke="rgba(0, 212, 255, 0.5)"
              strokeDasharray="2 3"
              label={{
                value: "Lake burst (T = 0)",
                position: "insideTopLeft",
                fill: "#94a3b8",
                fontSize: 10,
                fontStyle: "italic",
              }}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              content={<CustomTooltip />}
            />
            <Bar dataKey="time" radius={[0, 6, 6, 0]} barSize={20}>
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={severityConfig[entry.severity as SeverityLevel].color}
                  fillOpacity={0.8}
                />
              ))}
              <ErrorBar
                dataKey="high"
                direction="x"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1.5}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
