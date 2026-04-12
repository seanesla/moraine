import { create } from "zustand";
import type { InstallResult, Pack, UpdateReport } from "../types/pack";
import type { Lake } from "../types/lake";
import { apiFetch } from "../lib/api";
import { useAppStore } from "./appStore";

const STORAGE_KEY = "moraine.activeRegions";

interface PackState {
  packs: Pack[];
  activeRegionIds: string[];
  /** True until we know whether localStorage had a saved selection. */
  hydrated: boolean;

  // Phase 4: remote update state
  updateReport: UpdateReport | null;
  checkingUpdates: boolean;
  installingPackId: string | null;
  /** Last install error/success message — cleared on next check or install. */
  lastInstallMessage: { kind: "success" | "error"; text: string } | null;

  fetchPacks: () => Promise<void>;
  toggleRegion: (id: string) => void;
  setActiveRegions: (ids: string[]) => void;
  isActive: (id: string) => boolean;

  // Phase 4: actions
  checkUpdates: () => Promise<void>;
  installPack: (packId: string) => Promise<void>;
  clearInstallMessage: () => void;
}

/**
 * Load saved active region ids from localStorage.
 * Returns null if nothing saved (first run) or on parse error —
 * caller treats null as "auto-activate everything on first fetch".
 */
function loadSavedRegions(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

function saveRegions(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Swallow quota / privacy errors — toggling still works in-memory.
  }
}

export const usePackStore = create<PackState>((set, get) => ({
  packs: [],
  // Start with whatever localStorage had so the UI doesn't flicker before
  // the /api/packs fetch completes. null → empty array until packs arrive.
  activeRegionIds: loadSavedRegions() ?? [],
  hydrated: false,

  // Phase 4 state
  updateReport: null,
  checkingUpdates: false,
  installingPackId: null,
  lastInstallMessage: null,

  fetchPacks: async () => {
    // Mirrors the cold-start retry pattern from appStore.ts:23-42 —
    // backend may still be warming up when the app first launches.
    const maxAttempts = 15;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const packs = await apiFetch<Pack[]>("/api/packs");

        // If this is the first-ever run (no localStorage entry), auto-activate
        // every discovered pack. Otherwise, keep the saved selection but drop
        // any saved ids that no longer correspond to an installed pack.
        const saved = loadSavedRegions();
        const discoveredIds = packs.map((p) => p.manifest.id);
        let nextActive: string[];
        if (saved === null) {
          nextActive = discoveredIds;
          saveRegions(nextActive);
        } else {
          nextActive = saved.filter((id) => discoveredIds.includes(id));
          if (nextActive.length !== saved.length) {
            saveRegions(nextActive);
          }
        }

        set({ packs, activeRegionIds: nextActive, hydrated: true });
        return;
      } catch {
        if (attempt === maxAttempts - 1) {
          // Give up — leave packs empty, mark hydrated so the UI can show
          // an appropriate empty state instead of spinning forever.
          set({ hydrated: true });
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  },

  toggleRegion: (id) => {
    const current = get().activeRegionIds;
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    saveRegions(next);
    set({ activeRegionIds: next });
  },

  setActiveRegions: (ids) => {
    saveRegions(ids);
    set({ activeRegionIds: ids });
  },

  isActive: (id) => get().activeRegionIds.includes(id),

  // ── Phase 4: remote update actions ──────────────────────────────────

  checkUpdates: async () => {
    set({ checkingUpdates: true, lastInstallMessage: null });
    try {
      const report = await apiFetch<UpdateReport>("/api/packs/check_updates");
      set({ updateReport: report, checkingUpdates: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not check for updates";
      set({
        updateReport: {
          checked_at: new Date().toISOString(),
          registry_url: "",
          updates_available: [],
          new_packs: [],
          already_current: [],
          error: msg,
        },
        checkingUpdates: false,
      });
    }
  },

  installPack: async (packId) => {
    set({ installingPackId: packId, lastInstallMessage: null });
    try {
      const result = await apiFetch<InstallResult>("/api/packs/install", {
        method: "POST",
        body: JSON.stringify({ pack_id: packId }),
      });
      if (result.success) {
        // Refresh installed packs to reflect the new version. fetchPacks
        // also reconciles activeRegionIds against the new install set.
        await get().fetchPacks();
        // And refresh /api/lakes via the appStore so the new lakes show up.
        await useAppStore.getState().fetchLakes();
        // Re-check updates so the just-installed pack moves out of
        // updates_available and into already_current.
        await get().checkUpdates();
        set({
          installingPackId: null,
          lastInstallMessage: {
            kind: "success",
            text: `Installed ${packId} v${result.installed_version} (${result.installed_lake_count} lakes)`,
          },
        });
      } else {
        set({
          installingPackId: null,
          lastInstallMessage: {
            kind: "error",
            text: result.error ?? `Install failed for ${packId}`,
          },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Install request failed";
      set({
        installingPackId: null,
        lastInstallMessage: { kind: "error", text: msg },
      });
    }
  },

  clearInstallMessage: () => set({ lastInstallMessage: null }),
}));

/**
 * React hook returning only lakes whose pack is currently active.
 * Lakes with no `pack_id` (shouldn't happen in production — backend always
 * stamps one — but defensive for loose dev data) are treated as always-visible
 * so they don't silently disappear if the annotation is missing.
 */
export function useActiveLakes(): Lake[] {
  const lakes = useAppStore((s) => s.lakes);
  const activeRegionIds = usePackStore((s) => s.activeRegionIds);
  return lakes.filter((l) => !l.pack_id || activeRegionIds.includes(l.pack_id));
}
