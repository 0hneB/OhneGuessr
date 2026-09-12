export const CONFIG = {
  ROUNDS: 5,
  SCORE_MAX: 5000,           // points for a perfect guess
  SCORE_FALLOFF: 10,         // score = 5000·e^(-FALLOFF·d/scale)
  WORLD_SCALE_KM: 14916.862  // world map diagonal; scale for World scoring
};
