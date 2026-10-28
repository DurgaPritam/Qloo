import { overlapLevel, type OverlapLevel } from "./overlap";
import type { Confidence } from "./types";

/**
 * Sponsor fit between a rights holder (an act, team, plan or roster) and a brand, from Qloo's
 * pairwise affinity in both directions where Qloo gave it:
 *   forward  = the brand among the rights holder's fans
 *   backward = the rights holder among the brand's fans
 * fit = mean of the directions present × 100. Nothing commercial is scored or estimated: reach,
 * impressions and fees are always "to confirm".
 */
export interface FitEvidence {
  kind: "forward" | "backward" | "missing" | "to_confirm";
  /** Plain words, built from the values below only. */
  text: string;
  /** The Qloo value behind it (0–1), when there is one. */
  value: number | null;
  source: "qloo" | "none";
}

export interface SponsorFit {
  /** 0–100. */
  fit: number;
  level: OverlapLevel;
  confidence: Confidence;
  forward: number | null;
  backward: number | null;
  evidence: FitEvidence[];
}

export const TO_CONFIRM_COMMERCIAL = "Reach, impressions, fees and availability: to confirm with the rights holder and the brand.";

const known = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
const BY_LEVEL: Record<OverlapLevel, Confidence> = { strong: "high", clear: "medium", some: "low", unknown: "low" };

/** Null when Qloo gave no affinity either way: no fit is invented. */
export function scoreSponsorFit(
  holder: { name: string },
  brand: { name: string },
  input: { forward: number | null | undefined; backward: number | null | undefined },
): SponsorFit | null {
  const forward = known(input.forward) ? input.forward : null;
  const backward = known(input.backward) ? input.backward : null;
  const both = [forward, backward].filter((x): x is number => x !== null);
  if (!both.length) return null;
  const level = overlapLevel([forward, backward]);
  const confidence: Confidence = both.length === 2 ? BY_LEVEL[level] : BY_LEVEL[level] === "high" ? "medium" : BY_LEVEL[level];
  const evidence: FitEvidence[] = [];
  if (forward !== null) evidence.push({ kind: "forward", text: `${holder.name} fans over-index on ${brand.name}: Qloo affinity ${forward.toFixed(2)}.`, value: forward, source: "qloo" });
  if (backward !== null) evidence.push({ kind: "backward", text: `${brand.name} fans over-index on ${holder.name}: Qloo affinity ${backward.toFixed(2)}.`, value: backward, source: "qloo" });
  if (both.length === 1) {
    evidence.push({ kind: "missing", text: `Qloo gave one direction only, so confidence is at most medium.`, value: null, source: "none" });
  }
  evidence.push({ kind: "to_confirm", text: TO_CONFIRM_COMMERCIAL, value: null, source: "none" });
  return { fit: Math.round((both.reduce((s, x) => s + x, 0) / both.length) * 100), level, confidence, forward, backward, evidence };
}

const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

/** Best fit first; ties by confidence, then by name, so the order is stable. */
export function rankByFit<T extends { name: string; fit: SponsorFit }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.fit.fit - a.fit.fit || RANK[b.fit.confidence] - RANK[a.fit.confidence] || a.name.localeCompare(b.name));
}

/** A brand's sector for grouping: Qloo's first genre:brand tag, else "Other". */
export function sectorOf(brand: { sectors?: readonly string[] }): string {
  return brand.sectors?.[0] ?? "Other";
}

/** Qloo marks sports teams and leagues with a "Sports Organization" tag. */
export function isSportsOrganisation(entity: { tags?: readonly string[] }): boolean {
  return Boolean(entity.tags?.some((t) => t.toLowerCase() === "sports organization"));
}
