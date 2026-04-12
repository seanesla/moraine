export interface Village {
  name: string;
  name_nepali?: string;
  distance_km: number;
  elevation_m?: number;
  population?: number;
  lat?: number;
  lon?: number;
}

export interface Lake {
  id: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  elevation_m: number;
  volume_m3: number;
  dam_height_m: number;
  risk_rank: string;
  valley_slope: number;
  channel_width_m: number;
  channel_depth_m: number;
  manning_n: number;
  villages: Village[];
}
