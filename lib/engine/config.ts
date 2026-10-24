/**
 * Every engine threshold lives here. Values are first guesses until the probe shows Qloo's
 * real affinity and popularity distributions (see docs/after-key.md).
 */
export const ENGINE_CONFIG = {
  partners: {
    count: 3,
    minCategories: 2,
    /** Bias guard: anything more popular than this is "everyone likes it", not a crossover. */
    maxPopularity: 0.97,
    minAffinity: 0.3,
    /** score = affinity * (1 - popularity) ^ popularityExponent */
    popularityExponent: 0.5,
  },
  cities: {
    /** Heat cells within this distance of a city centre count towards it. */
    radiusKm: 40,
    /** Fewer cells than this on either side lowers confidence. */
    minCellsForHigh: 3,
  },
  places: {
    count: 5,
    minAffinity: 0.2,
    /** Weight kept by a place that matches none of the requested tags. */
    tagBaseWeight: 0.5,
  },
  brands: {
    count: 5,
    maxPopularity: 0.97,
    minAffinity: 0.2,
    popularityExponent: 0.5,
  },
  /** Applied to affinity for partners/places/brands and to min(sA, sB) for cities. */
  confidence: {
    high: 0.7,
    medium: 0.4,
  },
} as const;

export type EngineConfig = typeof ENGINE_CONFIG;
