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
} from "recharts";
import { severityConfig, type SeverityLevel } from "../../lib/severity";
import type { VillageResult } from "../../types/scenario";

interface ArrivalChartProps {
  villages: VillageResult[];
}

export default function ArrivalChart({ villages }: ArrivalChartProps) {
  const data = villages.map((v) => ({
    name: v.name,
    time: v.arrival_time_min,
    low: v.arrival_time_min - v.arrival_time_low_min,
    high: v.arrival_time_high_min - v.arrival_time_min,
    severity: v.severity,
  }));

  return (
    <div className="animate-fade-in-up" style={{ animationDelay: "0.5s" }}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
        Arrival Time Comparison
      </h3>
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
            <Tooltip
              contentStyle={{
                backgroundColor: "#141428",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                fontSize: 12,
                color: "#e8eaf0",
              }}
              formatter={(value: number) => [`${value.toFixed(1)} min`, "Arrival"]}
              cursor={{ fill: "rgba(255,255,255,0.02)" }}
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
