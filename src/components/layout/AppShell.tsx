import { useEffect } from "react";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import { useAppStore } from "../../stores/appStore";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const fetchLakes = useAppStore((s) => s.fetchLakes);

  useEffect(() => {
    fetchLakes();
  }, [fetchLakes]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-primary">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
