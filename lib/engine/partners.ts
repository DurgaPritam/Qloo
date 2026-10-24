import { ENGINE_CONFIG } from "./config";
import { byScoreThenId, confidenceFor, describeDropped, nicheScore, screen } from "./shared";
import type { Candidate, PartnerPick, RankResult } from "./types";

export interface ScorePartnersOptions {
  count?: number;
  minCategories?: number;
  maxPopularity?: number;
  minAffinity?: number;
  /** The seed itself and anything already used. */
  excludeIds?: readonly string[];
}

interface Scored {
  id: string;
  category: Candidate["category"];
  score: number;
  candidate: Candidate;
}

/**
 * Picks crossover partners: score = affinity * (1 - popularity)^0.5, bias guard on popularity,
 * affinity floor, top `count` spanning at least `minCategories` categories when possible.
 *
 * Fallbacks, always labelled: if nothing passes the affinity floor, the best candidates that only
 * failed the floor are used. The bias guard is never relaxed.
 */
export function scorePartners(
  candidates: readonly Candidate[],
  opts: ScorePartnersOptions = {},
): RankResult<PartnerPick, Candidate> {
  const cfg = ENGINE_CONFIG.partners;
  const count = opts.count ?? cfg.count;
  const minCategories = opts.minCategories ?? cfg.minCategories;
  const exclude = new Set(opts.excludeIds ?? []);

  const pool = candidates.filter((c) => !exclude.has(c.id));
  const { kept, dropped } = screen(pool, {
    maxPopularity: opts.maxPopularity ?? cfg.maxPopularity,
    minAffinity: opts.minAffinity ?? cfg.minAffinity,
  });
  const droppedNote = describeDropped(dropped);

  if (pool.length === 0) {
    return { picks: [], dropped, fallback: true, reason: "No partner candidates were returned." };
  }

  let eligible = kept;
  let relaxed = false;
  if (eligible.length === 0) {
    eligible = dropped.filter((d) => d.reason === "below_min_affinity").map((d) => d.item);
    relaxed = eligible.length > 0;
  }
  if (eligible.length === 0) {
    return {
      picks: [],
      dropped,
      fallback: true,
      reason: `No candidate passed the bias guard; ${droppedNote}.`,
    };
  }

  const scored = eligible
    .map((c) => ({
      id: c.id,
      category: c.category,
      score: nicheScore(c.affinity, c.popularity, cfg.popularityExponent),
      candidate: c,
    }))
    .sort(byScoreThenId);
  const chosen = pickDiverse(scored, count, minCategories);
  const categories = new Set(chosen.map((c) => c.category));

  const picks: PartnerPick[] = chosen.map(({ score, candidate }, i) => ({
    kind: "partner",
    rank: i + 1,
    score,
    confidence: relaxed ? "low" : confidenceFor(candidate.affinity),
    entity: candidate,
    evidence: { affinity: candidate.affinity, popularity: candidate.popularity },
  }));

  const summary = `Picked ${picks.length} from ${categories.size} ${plural(categories.size, "category", "categories")}; ${droppedNote}.`;
  if (relaxed) {
    return {
      picks,
      dropped,
      fallback: true,
      reason: `No candidate reached the affinity floor, so these are the closest below it. ${summary}`,
    };
  }
  if (categories.size < minCategories) {
    return {
      picks,
      dropped,
      fallback: true,
      reason: `Only one category had qualifying candidates. ${summary}`,
    };
  }
  if (picks.length < count) {
    return {
      picks,
      dropped,
      fallback: true,
      reason: `Only ${picks.length} ${plural(picks.length, "candidate", "candidates")} qualified. ${summary}`,
    };
  }
  return { picks, dropped, fallback: false, reason: summary };
}

/**
 * Greedy by score, but once the remaining slots are only enough to reach `minCategories`, only
 * new categories are accepted. Slots that still cannot be filled that way are filled by score.
 */
function pickDiverse(sorted: readonly Scored[], count: number, minCategories: number): Scored[] {
  const picks: Scored[] = [];
  const categories = new Set<string>();
  for (const c of sorted) {
    if (picks.length === count) break;
    const slotsLeft = count - picks.length;
    const newNeeded = minCategories - categories.size;
    if (categories.has(c.category) && slotsLeft <= newNeeded) continue;
    picks.push(c);
    categories.add(c.category);
  }
  for (const c of sorted) {
    if (picks.length === count) break;
    if (!picks.includes(c)) picks.push(c);
  }
  return picks.sort(byScoreThenId);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
