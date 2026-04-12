import { MessageSquare, LayoutDashboard, Settings } from "lucide-react";
import { useAppStore } from "../../stores/appStore";

export default function TopBar() {
  const { backendStatus, activeView, setActiveView, setSettingsOpen } = useAppStore();

  return (
    <div className="flex items-center justify-end px-3 gap-2 shrink-0">

      <div className="flex items-center gap-0.5 bg-[var(--color-glass-well)] backdrop-blur-[16px] rounded-full border border-white/[0.04] p-0.5">
        <NavPill active={activeView === "dashboard"} onClick={() => setActiveView("dashboard")}
          icon={<LayoutDashboard className="w-3 h-3" />} label="Dashboard" />
        <NavPill active={activeView === "chat"} onClick={() => setActiveView("chat")}
          icon={<MessageSquare className="w-3 h-3" />} label="Chat" />
      </div>

      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="Region settings"
        className="flex h-6 w-6 items-center justify-center rounded-full
          bg-[var(--color-glass-well)] backdrop-blur-[16px]
          border border-white/[0.04] hover:border-white/[0.14]
          text-text-muted hover:text-primary
          transition-all duration-200 cursor-pointer"
      >
        <Settings className="w-3 h-3" />
      </button>

      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        <span className={`w-1.5 h-1.5 rounded-full ${
          backendStatus === "ready" ? "bg-success" : backendStatus === "connecting" ? "bg-warning animate-pulse" : "bg-danger"
        }`} style={{ boxShadow: "0 0 4px currentColor" }} />
        <span>{backendStatus === "ready" ? "Online" : backendStatus === "connecting" ? "..." : "Offline"}</span>
      </div>
    </div>
  );
}

function NavPill({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1 rounded-full h-6 px-2.5 text-[10px] font-medium transition-all duration-200 cursor-pointer ${
        active
          ? "bg-[var(--color-glass)] text-primary border border-primary/30"
          : "text-text-muted hover:text-text-secondary border border-transparent"
      }`}
      style={active ? { boxShadow: "0 0 12px -4px var(--color-glow-primary)" } : undefined}
    >
      {icon}<span>{label}</span>
    </button>
  );
}
