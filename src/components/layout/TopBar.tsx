import { Mountain, MessageSquare, LayoutDashboard } from "lucide-react";
import { useAppStore } from "../../stores/appStore";

export default function TopBar() {
  const { backendStatus, activeView, setActiveView } = useAppStore();

  return (
    <div className="flex items-center justify-between h-12 px-5 border-b border-border bg-bg-surface/70 backdrop-blur-md shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center shadow-[0_0_12px_-4px_var(--glow-cyan)]">
          <Mountain className="w-4 h-4 text-accent-cyan" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight">Moraine</span>
        <span className="text-[10px] text-text-muted font-medium tracking-wider uppercase">
          GLOF Response
        </span>
      </div>

      {/* Nav + status */}
      <div className="flex items-center gap-3">
        <div className="flex glass-well rounded-full p-0.5 gap-0.5">
          <NavPill active={activeView === "dashboard"} onClick={() => setActiveView("dashboard")}
            icon={<LayoutDashboard className="w-3.5 h-3.5" />} label="Dashboard" />
          <NavPill active={activeView === "chat"} onClick={() => setActiveView("chat")}
            icon={<MessageSquare className="w-3.5 h-3.5" />} label="Chat" />
        </div>

        <div className="w-px h-3 bg-gradient-to-b from-transparent via-white/8 to-transparent" />

        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${
            backendStatus === "ready"
              ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
              : backendStatus === "connecting"
                ? "bg-amber-400 animate-pulse"
                : "bg-red-400"
          }`} />
          <span className="text-[10px] text-text-muted font-medium">
            {backendStatus === "ready" ? "Online" : backendStatus === "connecting" ? "Connecting" : "Offline"}
          </span>
        </div>
      </div>
    </div>
  );
}

function NavPill({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 h-8 rounded-full text-[11px] font-semibold transition-all duration-200 cursor-pointer ${
        active
          ? "bg-[var(--glass-default)] text-accent-cyan border border-accent-cyan/25 shadow-[0_0_12px_-4px_var(--glow-cyan),inset_0_1px_0_rgba(255,255,255,0.06)]"
          : "text-text-muted hover:text-text-secondary border border-transparent"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
