/**
 * The landing page's one-click examples: one per format, chosen on real Qloo runs for the most
 * specific results (docs/decisions.md D32). They are preloaded by scripts/warm-cache.ts.
 */
export const EXAMPLES = [
  { kind: "Comedian", name: "John Mulaney" },
  { kind: "Music artist", name: "Phoebe Bridgers" },
  { kind: "Film", name: "Sinners" },
  { kind: "Sports team", name: "Arsenal" },
] as const;
