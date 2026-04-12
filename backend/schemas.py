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
