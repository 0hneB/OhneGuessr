export const CONFIG = {
  ROUNDS: 5,
  SCORE_MAX: 5000,           // points for a perfect guess
  SCORE_FALLOFF: 10,         // score = 5000·e^(-FALLOFF·d/scale)
  WORLD_SCALE_KM: 14916.862  // world map diagonal; scale for World scoring
};

// KeyboardEvent.code values per action. Several codes = several keys; [] disables.
export const KEYBINDINGS = {
  submitOrNext: ['Space'],
  zoomIn: ['KeyE'],
  zoomOut: ['KeyQ'],
  resetView: ['KeyR'],
  checkpoint: ['KeyC'],
  checkpointPeek: ['KeyV'],
  lookBehind: ['KeyB'],
  faceNorth: ['KeyN'],
  toggleMapPinned: ['KeyM'],
  toggleMapFullscreen: ['KeyF'],
  mapSizeDefault: ['Digit1'],
  mapSizeLarge: ['Digit2'],
  mapSizeXl: ['Digit3'],
  mapSizeXxl: ['Digit4'],
  hideHud: ['KeyH']
};
