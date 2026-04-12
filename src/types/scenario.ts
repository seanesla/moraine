export interface DischargeResult {
  popov_m3s: number;
  huggel_m3s: number;
  average_m3s: number;
  low_m3s: number;
  high_m3s: number;
  spread_percent: number;
}

export interface VillageResult {
  name: string;
  distance_km: number;
  arrival_time_min: number;
  arrival_time_low_min: number;
  arrival_time_high_min: number;
  attenuated_discharge_m3s: number;
  severity: "EXTREME" | "SEVERE" | "HIGH" | "MODERATE" | "LOW";
  elevation_m?: number;
  population?: number;
  name_nepali?: string;
}

export interface ScenarioParams {
  lake_volume_m3: number;
  valley_slope: number;
  channel_width_m: number;
  channel_depth_m: number;
  manning_n: number;
  wave_multiplier: number;
  decay_rate: number;
}

export interface ScenarioResult {
  discharge: DischargeResult;
  hydraulic_radius_m: number;
  flow_velocity_mps: number;
  wave_speed_mps: number;
  parameters: Record<string, number>;
  villages: VillageResult[];
}
