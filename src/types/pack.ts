// Mirrors backend/schemas.py RegionBounds / PackManifest / Pack /
// UpdateReport / PackUpdate / RemotePackEntry / InstallResult.
// The /api/packs router returns Pack without the internal `path` field,
// and `lake_count` lives on the nested manifest (not the top level).

export interface RegionBounds {
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
}

export interface PackManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  last_updated: string;
  source: string;
  source_url?: string | null;
  lake_count: number;
  region_bounds?: RegionBounds | null;
  size_bytes?: number | null;
  sha256?: string | null;
}

export interface Pack {
  manifest: PackManifest;
  is_bundled: boolean;
  is_user_installed: boolean;
}

// ── Phase 4: Remote update types ────────────────────────────────────────

export interface PackUpdate {
  id: string;
  name: string;
  installed_version: string;
  available_version: string;
  lake_count: number;
  released: string;
}

export interface RemotePackEntry {
  id: string;
  version: string;
  name: string;
  description: string;
  lake_count: number;
  manifest_url: string;
  lakes_url: string;
  sha256: string;
  released: string;
}

export interface UpdateReport {
  checked_at: string;
  registry_url: string;
  updates_available: PackUpdate[];
  new_packs: RemotePackEntry[];
  already_current: string[];
  error?: string | null;
}

export interface InstallResult {
  success: boolean;
  pack_id: string;
  installed_version?: string | null;
  installed_lake_count?: number | null;
  install_path?: string | null;
  error?: string | null;
}
