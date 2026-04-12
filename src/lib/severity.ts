export type SeverityLevel = "EXTREME" | "SEVERE" | "HIGH" | "MODERATE" | "LOW";

export const severityConfig: Record<
  SeverityLevel,
  { gradient: string; color: string; textColor: string; label: string }
> = {
  EXTREME: {
    gradient: "linear-gradient(135deg, #b91c1c, #dc2626)",
    color: "#dc2626",
    textColor: "#ffffff",
    label: "EXTREME",
  },
  SEVERE: {
    gradient: "linear-gradient(135deg, #c2410c, #ea580c)",
    color: "#ea580c",
    textColor: "#ffffff",
    label: "SEVERE",
  },
  HIGH: {
    gradient: "linear-gradient(135deg, #d97706, #f59e0b)",
    color: "#f59e0b",
    textColor: "#ffffff",
    label: "HIGH",
  },
  MODERATE: {
    gradient: "linear-gradient(135deg, #ca8a04, #eab308)",
    color: "#eab308",
    textColor: "#1e293b",
    label: "MODERATE",
  },
  LOW: {
    gradient: "linear-gradient(135deg, #15803d, #22c55e)",
    color: "#22c55e",
    textColor: "#ffffff",
    label: "LOW",
  },
};

