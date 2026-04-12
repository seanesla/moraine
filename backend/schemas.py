from pydantic import BaseModel, Field


class VillageInput(BaseModel):
    name: str
    distance_km: float
    name_nepali: str | None = None
    elevation_m: float | None = None
    population: int | None = None
    lat: float | None = None
    lon: float | None = None


class ScenarioRequest(BaseModel):
    lake_volume_m3: float = Field(gt=0)
    valley_slope: float = Field(gt=0, lt=1)
    channel_width_m: float = Field(gt=0)
    channel_depth_m: float = Field(gt=0)
    manning_n: float = Field(gt=0, lt=1)
    villages: list[VillageInput]
    wave_multiplier: float = 1.5
    decay_rate: float = 0.30


class DischargeResult(BaseModel):
    popov_m3s: float
    huggel_m3s: float
    average_m3s: float
    low_m3s: float
    high_m3s: float
    spread_percent: float


class VillageResult(BaseModel):
    name: str
    distance_km: float
    arrival_time_min: float
    arrival_time_low_min: float
    arrival_time_high_min: float
    attenuated_discharge_m3s: float
    severity: str
    elevation_m: float | None = None
    population: int | None = None
    name_nepali: str | None = None


class ScenarioResponse(BaseModel):
    discharge: DischargeResult
    hydraulic_radius_m: float
    flow_velocity_mps: float
    wave_speed_mps: float
    parameters: dict
    villages: list[VillageResult]


class LakeVillage(BaseModel):
    name: str
    name_nepali: str | None = None
    distance_km: float
    elevation_m: float | None = None
    population: int | None = None
    lat: float | None = None
    lon: float | None = None


class Lake(BaseModel):
    id: str
    name: str
    country: str
    region: str
    lat: float
    lon: float
    elevation_m: float
    volume_m3: float
    dam_height_m: float
    risk_rank: str
    valley_slope: float
    channel_width_m: float
    channel_depth_m: float
    manning_n: float
    villages: list[LakeVillage]
    # Id of the pack this lake came from. Optional for backwards
    # compatibility with any caller that constructs a Lake by hand;
    # populated automatically when lakes are loaded via the pack system
    # so the frontend can filter by active region.
    pack_id: str | None = None


class RegionBounds(BaseModel):
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


class PackManifest(BaseModel):
    id: str
    name: str
    description: str
    version: str
    last_updated: str
    source: str
    source_url: str | None = None
    lake_count: int
    region_bounds: RegionBounds | None = None
    # size_bytes and sha256 are optional because hand-authored packs may
    # skip them; the remote update system in Phase 4 will always populate them.
    size_bytes: int | None = None
    sha256: str | None = None


class Pack(BaseModel):
    manifest: PackManifest
    is_bundled: bool
    is_user_installed: bool
    # Absolute path to the pack directory on disk. Kept internal — the
    # /api/packs router will strip this before returning to the client.
    path: str


# ── Phase 4: Remote update schemas ────────────────────────────────────────


class RemotePackEntry(BaseModel):
    """One entry in the remote registry's index.json."""
    id: str
    version: str
    name: str
    description: str
    lake_count: int
    manifest_url: str
    lakes_url: str
    sha256: str
    released: str  # ISO date


class PackUpdate(BaseModel):
    """An update available for an already-installed pack."""
    id: str
    name: str
    installed_version: str
    available_version: str
    lake_count: int
    released: str


class UpdateReport(BaseModel):
    """Result of GET /api/packs/check_updates."""
    checked_at: str
    registry_url: str
    updates_available: list[PackUpdate]
    new_packs: list[RemotePackEntry]
    already_current: list[str]
    error: str | None = None


class InstallRequest(BaseModel):
    pack_id: str


class InstallResult(BaseModel):
    """Result of POST /api/packs/install."""
    success: bool
    pack_id: str
    installed_version: str | None = None
    installed_lake_count: int | None = None
    install_path: str | None = None
    error: str | None = None
