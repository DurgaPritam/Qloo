/**
 * The landing page's one-click examples: one per format, chosen on real Qloo runs for the most
 * specific results. They are preloaded by scripts/warm-cache.ts.
 */
export const EXAMPLES = [
  { kind: "Comedian", name: "John Mulaney" },
  { kind: "Music artist", name: "Phoebe Bridgers" },
  { kind: "Film", name: "Sinners" },
  { kind: "Sports team", name: "Arsenal" },
] as const;

/** Likely judge inputs beyond the four chips, also preloaded. */
export const JUDGE_INPUTS = [
  "Kevin Hart",
  "Ali Wong",
  "Taylor Swift",
  "Bad Bunny",
  "Billie Eilish",
  "Manchester United",
  "Golden State Warriors",
  "Call Her Daddy",
  "Dune: Part Two",
  "Black Country, New Road",
] as const;

/** Every preloaded run, in the order shown on Explore. */
export const SHOWCASE: readonly string[] = [...EXAMPLES.map((e) => e.name), ...JUDGE_INPUTS];
