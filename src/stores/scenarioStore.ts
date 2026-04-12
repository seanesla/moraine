import { create } from "zustand";
import type { ScenarioParams, ScenarioResult } from "../types/scenario";
import type { Village } from "../types/lake";
import { apiFetch } from "../lib/api";

interface ScenarioState {
  params: ScenarioParams;
  result: ScenarioResult | null;
  isRunning: boolean;
  error: string | null;

  setParam: <K extends keyof ScenarioParams>(key: K, value: ScenarioParams[K]) => void;
  setAllParams: (params: ScenarioParams) => void;
  runScenario: (villages: Village[]) => Promise<void>;
  clearResult: () => void;
}

const defaultParams: ScenarioParams = {
  lake_volume_m3: 61700000,
  valley_slope: 0.04,
  channel_width_m: 40,
  channel_depth_m: 5,
  manning_n: 0.07,
  wave_multiplier: 1.5,
  decay_rate: 0.30,
};

export const useScenarioStore = create<ScenarioState>((set, get) => ({
  params: { ...defaultParams },
  result: null,
  isRunning: false,
  error: null,

  setParam: (key, value) =>
    set((state) => ({ params: { ...state.params, [key]: value } })),

  setAllParams: (params) => set({ params }),

  runScenario: async (villages) => {
    if (get().isRunning) return;
    set({ isRunning: true, error: null });
    try {
      const { params } = get();
      const result = await apiFetch<ScenarioResult>("/api/scenario", {
        method: "POST",
        body: JSON.stringify({
          ...params,
          villages: villages.map((v) => ({
            name: v.name,
            distance_km: v.distance_km,
            name_nepali: v.name_nepali,
            elevation_m: v.elevation_m,
            population: v.population,
          })),
        }),
      });
      set({ result, isRunning: false });
    } catch (err) {
      set({ error: String(err), isRunning: false });
    }
  },

  clearResult: () => set({ result: null, error: null }),
}));
