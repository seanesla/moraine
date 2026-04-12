import { create } from "zustand";
import type { Lake } from "../types/lake";
import { apiFetch } from "../lib/api";

interface AppState {
  lakes: Lake[];
  selectedLakeId: string | null;
  backendStatus: "connecting" | "ready" | "error";
  activeView: "dashboard" | "chat";
  settingsOpen: boolean;

  fetchLakes: () => Promise<void>;
  setSelectedLake: (id: string | null) => void;
  setBackendStatus: (status: AppState["backendStatus"]) => void;
  setActiveView: (view: AppState["activeView"]) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  lakes: [],
  selectedLakeId: null,
  backendStatus: "connecting",
  activeView: "dashboard",
  settingsOpen: false,

  fetchLakes: async () => {
    // Retry up to ~12 seconds to let the backend warm up on cold start
    const maxAttempts = 15;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const lakes = await apiFetch<Lake[]>("/api/lakes");
        set({ lakes, backendStatus: "ready" });
        // Note: initial lake selection is owned by the Sidebar, which picks
        // from the *active* lakes (filtered by packStore) so we don't land
        // on a hidden lake when the user has some regions toggled off.
        return;
      } catch {
        if (attempt === maxAttempts - 1) {
          set({ backendStatus: "error" });
          return;
        }
        // 800ms backoff between attempts
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  },

  setSelectedLake: (id) => set({ selectedLakeId: id }),
  setBackendStatus: (status) => set({ backendStatus: status }),
  setActiveView: (view) => set({ activeView: view }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
