// Game / rendering configuration.
export const CONFIG = {
  ROUNDS: 5,            // rounds per game
  RENDER_ZOOM: 4,      // Default Street View tile zoom 0..5 (overridden by the
                       // Quality setting). Auto-caps to the GPU max texture size.
  PREVIEW_ZOOM: 2,     // First-pass pano zoom shown before the selected quality
                       // finishes loading.
  TILE_LOAD_CONCURRENCY: 12, // Cap concurrent Street View tile image requests.
  TILE_SIZE: 512,      // Street View tile pixel size.
  MAX_PANO_ZOOM: 5,    // zoom level the stored w/h correspond to.
  SCORE_MAX: 5000,     // max points per round.
  SCORE_SCALE_KM: 2000, // distance falloff; ~GeoGuessr world map feel.

  // Global compass calibration for the texture convention. Each pano's own
  // heading (`north`, from metadata) is subtracted separately, so these two are
  // the SAME for every location: flip HEADING_SIGN to -1 if the compass turns
  // the wrong way; set HEADING_OFFSET (deg) if north is rotated by a constant.
  HEADING_SIGN: 1,
  HEADING_OFFSET: 0
};
