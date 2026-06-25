export const CONFIG = {
  ROUNDS: 5,
  PREVIEW_ZOOM: 2,           // shown until the selected quality loads
  TILE_LOAD_CONCURRENCY: 12,
  TILE_SIZE: 512,
  MAX_PANO_ZOOM: 5,          // zoom the stored w/h are measured at
  SCORE_MAX: 5000,           // points for a perfect guess
  SCORE_FALLOFF: 10,         // score = 5000·e^(-FALLOFF·d/scale)
  WORLD_SCALE_KM: 14916.862, // world map diagonal; scale for World scoring

  // Texture calibration, identical for every pano (per-pano north is subtracted
  // in pano.js). Sign -1 reverses the compass; offset rotates north by a constant.
  HEADING_SIGN: 1,
  HEADING_OFFSET: 0
};

// KeyboardEvent.code values per action. Several codes = several keys; [] disables.
export const KEYBINDINGS = {
  submitOrNext: ['Space'],
  zoomIn: ['KeyE'],
  zoomOut: ['KeyQ'],
  resetView: ['KeyR'],
  faceNorth: ['KeyN'],
  toggleMapFullscreen: ['KeyF'],
  hideHud: ['KeyH']
};
