import { useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import DarkVeil from "../common/DarkVeil";
import RegionManager from "../settings/RegionManager";
import { useAppStore } from "../../stores/appStore";
import { usePackStore } from "../../stores/packStore";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const fetchLakes = useAppStore((s) => s.fetchLakes);
  const fetchPacks = usePackStore((s) => s.fetchPacks);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  useEffect(() => {
    fetchLakes();
    fetchPacks();
  }, [fetchLakes, fetchPacks]);

  const handleDrag = useCallback((e: React.MouseEvent) => {
    if (e.buttons === 1) {
      if (e.detail === 2) {
        getCurrentWindow().toggleMaximize();
      } else {
        getCurrentWindow().startDragging();
      }
    }
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden relative">
      {/* Animated background */}
      <div className="absolute inset-0 z-0 pointer-events-none blur-[6px]">
        <DarkVeil speed={0.6} />
      </div>

      {/* Title bar — drag via startDragging API */}
      <div className="h-10 shrink-0 relative cursor-default z-10" onMouseDown={handleDrag}>
        <div className="absolute left-20 top-0 h-full flex items-baseline"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ paddingTop: "11px" }}>
          <span className="text-[13px] font-semibold tracking-[0.08em] text-text-primary/85 leading-none">
            moraine
          </span>
        </div>
        <div className="absolute right-3 top-0 h-full flex items-center"
          onMouseDown={(e) => e.stopPropagation()}>
          <TopBar />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden relative z-10">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <main className="flex-1 overflow-y-auto pt-6 px-6 pb-12 flex flex-col min-h-0">
            {children}
          </main>
        </div>
      </div>

      {/* Region settings overlay — mounted unconditionally so its
          mount/unmount animations don't fight the dialog's own state. */}
      <RegionManager open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
