export interface Village {
  name: string;
  name_nepali?: string;
  distance_km: number;
  elevation_m?: number;
  population?: number;
  lat?: number;
  lon?: number;
  /**
   * Real river/flow path from the lake outlet to this village, traced
   * from DEM flow direction by scripts/build_pack_rivers.py and served
   * via /api/lakes. Each entry is [lat, lon] in Leaflet order. Absent
   * when the pack hasn't been built with rivers.geojson yet, or when
   * the village could not be matched to the lake's downhill walk.
   */
  river_path?: [number, number][];
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
  /** Id of the regional pack this lake belongs to (e.g. "hkh", "andes"). */
  pack_id?: string;
}
