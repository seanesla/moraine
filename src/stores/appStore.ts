import { create } from "zustand";
import type { Lake } from "../types/lake";
import { apiFetch } from "../lib/api";

interface AppState {
  lakes: Lake[];
  selectedLakeId: string | null;
  backendStatus: "connecting" | "ready" | "error";
  activeView: "dashboard" | "chat";

  fetchLakes: () => Promise<void>;
  setSelectedLake: (id: string) => void;
  setBackendStatus: (status: AppState["backendStatus"]) => void;
  setActiveView: (view: AppState["activeView"]) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  lakes: [],
  selectedLakeId: null,
  backendStatus: "connecting",
  activeView: "dashboard",

  fetchLakes: async () => {
    try {
      const lakes = await apiFetch<Lake[]>("/api/lakes");
      set({ lakes, backendStatus: "ready" });
      if (!get().selectedLakeId && lakes.length > 0) {
        get().setSelectedLake(lakes[0].id);
      }
    } catch {
      set({ backendStatus: "error" });
    }
  },

  setSelectedLake: (id) => set({ selectedLakeId: id }),
  setBackendStatus: (status) => set({ backendStatus: status }),
  setActiveView: (view) => set({ activeView: view }),
}));
