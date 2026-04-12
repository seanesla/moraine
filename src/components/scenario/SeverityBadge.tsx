import type { SeverityLevel } from "../../lib/severity";
import { severityConfig } from "../../lib/severity";

export default function SeverityBadge({ severity }: { severity: SeverityLevel }) {
  const config = severityConfig[severity];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: config.gradient,
        color: config.textColor,
      }}
    >
      {config.label}
    </span>
  );
}
