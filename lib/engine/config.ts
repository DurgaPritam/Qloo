import type { Category } from "./types";

/**
 * Every engine threshold lives here. Values are first guesses until the probe shows Qloo's
 * real affinity and popularity distributions (see docs/after-key.md).
 */
export const ENGINE_CONFIG = {
  partners: {
    count: 3,
    minCategories: 2,
    /**
     * Popularity band (Qloo popularity is a percentile bunched near 1; docs/tuning.md).
     * Above maxPopularity is a mega-star or generic platform (YouTube, Netflix, Rihanna);
     * below minPopularity is too obscure to draw a crowd (many of these have popularity 0).
     */
    maxPopularity: 0.999,
    minPopularity: 0.5,
    /**
     * Affinity is compared within each category: 0 = the category's median candidate, 1 = its best.
     * A partner must sit above its category's median.
     */
    minRelativeAffinity: 0,
    /** score = relativeAffinity * (1 - popularity) ^ popularityExponent: a gentle mainstream discount. */
    popularityExponent: 0.15,
  },
  cities: {
    /** Heat cells within this distance of a city centre count towards it. */
    radiusKm: 40,
    /** Used instead when city-level data is thin ("regional overlap"). */
    regionalRadiusKm: 150,
    /** Fewer cells than this on either side lowers confidence. */
    minCellsForHigh: 3,
    /**
     * A city within this distance of a larger one is folded into it (boroughs, suburbs). Equal to
     * radiusKm, since closer cities would share the same heat cells.
     */
    metroMergeKm: 40,
    /** Rows in the "with Qloo vs population" table. */
    tableSize: 5,
  },
  tour: {
    stops: 6,
    /** Exact ordering tries every order, so keep this small (8! = 40,320). */
    maxStops: 8,
    /** Stops closer than this would split one audience across two nights. */
    minSpacingKm: 150,
    /** A stop must score at least this combined (0–1). */
    minCombined: 0.3,
    /** Tours stay in the chosen city's country; below this many stops they widen to a radius. */
    minStopsInCountry: 3,
    /** The radius around the chosen city used when the country alone is too thin. */
    widenKm: 2500,
  },
  /**
   * Tour optimizer (lib/engine/route.ts): objective = Σ stop score (0–100) − distanceWeight ×
   * total km ÷ 1,000. With 5, a route 1,000 km longer must gain 5 score points to win.
   */
  route: {
    distanceWeight: 5,
    /** Candidate cities are searched exactly up to this many; above it, the heuristic. */
    exactMaxCandidates: 9,
    /** The strongest cities considered (plus any you named). */
    candidatePool: 14,
    maxStops: 12,
    /** Two stops closer than this would share one audience. */
    minSpacingKm: 150,
    /** Strong cities left out that get a "why not". */
    whyNot: 6,
  },
  /** Venue booker: who people in a city over-index on, with no fanbase signal. */
  local: {
    count: 8,
    /** Same band as partners: no mega-stars, nothing too obscure to sell tickets. */
    maxPopularity: 0.999,
    minPopularity: 0.5,
  },
  /**
   * Overlap checker: Qloo affinity of one entity among the other's fans. Among the top 20
   * partner candidates of real fanbases, affinity ran 0.81–0.99 with a median of 0.92
   * (docs/tuning.md), so 0.92+ is as strong as a typical top crossover.
   */
  overlap: { strong: 0.92, clear: 0.85 },
  /**
   * Market watch: what counts as a change between two weekly snapshots of a top list. Values are
   * Qloo affinity (partners, a city's top entities) or city heat scaled to the hottest city, 0–1.
   */
  watch: {
    /** Lists are compared over their top N. */
    topN: 10,
    /** A move of this many places or more. */
    rankMove: 3,
    /** A change of this much or more (0.05 = 5 points on the 0–100 scale shown). */
    valueChange: 0.05,
  },
  /**
   * Outcomes: a city or partner needs this many logged events before the report says whether it
   * beats the workspace's median sell-through; below it the report says "too few events to judge".
   */
  outcomes: { minSample: 5 },
  /** Audience profile: a skew below this (either way) reads as "balanced". */
  audience: { lean: 0.1 },
  places: {
    /** Venues considered for the main room. */
    count: 5,
    /** After-show or watch-party spots. */
    spots: 3,
    minAffinity: 0.2,
    /** Weight kept by a place that matches none of the requested tags. */
    tagBaseWeight: 0.5,
    /** Each later requested tag is this much less preferred than the first (floor 0.7). */
    tagOrderStep: 0.1,
    /** Weight kept by a room tagged with one of the format's avoidTags (a stadium for a podcast). */
    wrongSizeWeight: 0.5,
  },
  brands: {
    count: 3,
    /** Sponsors may be big brands, but not the absolute top (Victoria's Secret, Starbucks, Netflix). */
    maxPopularity: 0.9995,
    minPopularity: 0.5,
    minRelativeAffinity: 0,
    popularityExponent: 0.15,
  },
  /** Partners: thresholds on relative affinity. Cities: on min(sA, sB). */
  confidence: {
    high: 0.7,
    medium: 0.4,
  },
  /** Venues and sponsors: by how many results qualified and the gap between first and second. */
  rankConfidence: {
    highCount: 5,
    mediumCount: 2,
    /** (score1 - score2) / score1 below this makes the top pick one level less certain. */
    minRelativeGap: 0.05,
  },
  match: {
    /** Name similarity (0–1) at or above which a search result counts as the same name. */
    exactSimilarity: 0.95,
    /** Below this a result is not offered as a "did you mean" suggestion. */
    suggestSimilarity: 0.5,
    maxOptions: 3,
    /**
     * Two same-name matches in different categories are ambiguous unless one is clearly better
     * known: its distance from popularity 1 is at least this many times smaller.
     */
    dominanceFactor: 5,
  },
} as const;

export type FormatId = "tour_stop" | "screening_tour" | "live_show" | "fan_fest";

export interface FormatRule {
  format: FormatId;
  /** Smallest city worth the format. */
  minPopulation: number;
  /** Any of these makes a place a candidate main room. */
  venueTags: readonly string[];
  /** Any of these makes a place an after-show or watch-party spot. */
  spotTags: readonly string[];
  /** Rooms with these tags are the wrong size for the format: kept, but weighted down. */
  avoidTags?: readonly string[];
}

const NOT_A_STADIUM: readonly string[] = ["stadium", "arena"];

export const FORMAT_LABEL: Record<FormatId, string> = {
  tour_stop: "Tour stop",
  screening_tour: "Screening tour",
  live_show: "Live show",
  fan_fest: "Fan fest",
};

/**
 * Readable place tags, as Qloo names them (docs/qloo-shapes.md); lib/qloo/tags.ts maps them to ids.
 * Sports teams are Qloo brands, so brands get the fan fest.
 */
export const FORMAT_BY_CATEGORY: Record<Category, FormatRule> = {
  artist: {
    format: "tour_stop",
    avoidTags: NOT_A_STADIUM,
    minPopulation: 250_000,
    venueTags: ["live music venue", "concert hall"],
    spotTags: ["bar", "night club"],
  },
  // Comedians. Other people (actors, hosts) get PERSON_LIVE_SHOW via formatFor.
  person: {
    format: "tour_stop",
    avoidTags: NOT_A_STADIUM,
    minPopulation: 250_000,
    venueTags: ["comedy club", "performing arts theater"],
    spotTags: ["bar", "pub"],
  },
  movie: {
    format: "screening_tour",
    avoidTags: NOT_A_STADIUM,
    minPopulation: 150_000,
    venueTags: ["movie theater"],
    spotTags: ["bar", "pub"],
  },
  tv_show: {
    format: "screening_tour",
    avoidTags: NOT_A_STADIUM,
    minPopulation: 150_000,
    venueTags: ["movie theater"],
    spotTags: ["bar", "pub"],
  },
  podcast: {
    format: "live_show",
    avoidTags: NOT_A_STADIUM,
    minPopulation: 250_000,
    venueTags: ["performing arts theater", "comedy club", "live music venue"],
    spotTags: ["bar", "cafe"],
  },
  book: {
    format: "live_show",
    avoidTags: NOT_A_STADIUM,
    minPopulation: 150_000,
    venueTags: ["performing arts theater", "book store"],
    spotTags: ["cafe", "bar"],
  },
  brand: {
    format: "fan_fest",
    minPopulation: 300_000,
    venueTags: ["stadium", "arena", "sports bar"],
    spotTags: ["sports bar", "pub", "bar"],
  },
  videogame: {
    format: "fan_fest",
    minPopulation: 300_000,
    venueTags: ["arena", "convention center"],
    spotTags: ["bar", "night club"],
  },
  place: {
    format: "fan_fest",
    minPopulation: 300_000,
    venueTags: ["arena", "stadium"],
    spotTags: ["bar", "pub"],
  },
};

/** People whose Qloo description is not comedy (actors, hosts): a live show in a theatre. */
export const PERSON_LIVE_SHOW: FormatRule = {
  format: "live_show",
  minPopulation: 250_000,
  venueTags: ["performing arts theater", "live music venue"],
  spotTags: ["bar", "pub"],
};

/**
 * Brand types never offered as sponsors (Qloo `brand_type`). "Entertainment Brand" is how Qloo
 * types sports teams and leagues: a Warriors fan fest was offered the Lakers as a sponsor.
 */
export const NON_SPONSOR_BRAND_TYPES: readonly string[] = ["Nonprofit Brand", "Government Brand", "Entertainment Brand"];

export type EngineConfig = typeof ENGINE_CONFIG;
