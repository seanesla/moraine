import { useEffect, useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import DarkVeil from "../common/DarkVeil";
import { useAppStore } from "../../stores/appStore";

const SUBTITLE_PHRASES = [
  "glof early warning",
  "flood simulator",
  "lake monitor",
  "risk forecaster",
  "himalayan watch",
];

function RotatingSubtitle() {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIndex((i) => (i + 1) % SUBTITLE_PHRASES.length);
        setFading(false);
      }, 350);
    }, 3200);
    return () => clearInterval(interval);
  }, []);

  return (
    <span
      className="inline-block text-[9px] text-text-muted/60 font-medium tracking-[0.18em] uppercase transition-all duration-300 ease-out whitespace-nowrap"
      style={{
        opacity: fading ? 0 : 1,
        transform: fading ? "translateY(-2px)" : "translateY(0)",
        minWidth: "130px",
      }}
    >
      {SUBTITLE_PHRASES[index]}
    </span>
  );
}

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
    <div className="flex flex-col h-screen overflow-hidden relative">
      {/* Animated background */}
      <div className="absolute inset-0 z-0 pointer-events-none blur-[6px]">
        <DarkVeil speed={0.6} />
      </div>

      {/* Title bar — drag via startDragging API */}
      <div className="h-10 shrink-0 relative cursor-default z-10" onMouseDown={handleDrag}>
        <div className="absolute left-20 top-0 h-full flex items-baseline gap-2.5"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ paddingTop: "11px" }}>
          <span className="text-[13px] font-semibold tracking-[0.08em] text-text-primary/85 leading-none">
            moraine
          </span>
          <span className="text-text-muted/30 leading-none select-none">·</span>
          <RotatingSubtitle />
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
    </div>
  );
}
