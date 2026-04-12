import { useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import { useAppStore } from "../../stores/appStore";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const fetchLakes = useAppStore((s) => s.fetchLakes);

  useEffect(() => {
    fetchLakes();
  }, [fetchLakes]);

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
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Title bar — drag via startDragging API */}
      <div className="h-10 shrink-0 relative cursor-default" onMouseDown={handleDrag}>
        <div className="absolute right-3 top-0 h-full flex items-center"
          onMouseDown={(e) => e.stopPropagation()}>
          <TopBar />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <main className="flex-1 overflow-y-auto pt-6 px-6 pb-12 flex flex-col min-h-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
