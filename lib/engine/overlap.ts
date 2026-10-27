import { ENGINE_CONFIG } from "./config";

export type OverlapLevel = "strong" | "clear" | "some" | "unknown";

/** The higher of the two directions decides; both are shown. */
export function overlapLevel(affinities: readonly (number | null)[], cfg = ENGINE_CONFIG.overlap): OverlapLevel {
  const known = affinities.filter((a): a is number => typeof a === "number" && Number.isFinite(a));
  if (known.length === 0) return "unknown";
  const best = Math.max(...known);
  return best >= cfg.strong ? "strong" : best >= cfg.clear ? "clear" : "some";
}
