/**
 * The landing page's one-click examples: one per format. In mock mode they get scripted
 * categories (lib/qloo/mock-data); check each resolves cleanly once the probe runs.
 */
export const EXAMPLES = [
  { kind: "Comedian", name: "John Mulaney" },
  { kind: "Music artist", name: "Phoebe Bridgers" },
  { kind: "Film", name: "Everything Everywhere All at Once" },
  { kind: "Sports team", name: "Golden State Warriors" },
] as const;
