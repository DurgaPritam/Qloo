import { ENGINE_CONFIG } from "./config";
import { byScoreThenId, confidenceFor, describeDropped, nicheScore, relativeAffinity, screenRelative } from "./shared";
import type { Candidate, PartnerPick, RankResult } from "./types";

export interface ScorePartnersOptions {
  count?: number;
  minCategories?: number;
  maxPopularity?: number;
  minPopularity?: number;
  /** On relative affinity (0 = category median, 1 = category best). */
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
 * Picks crossover partners. Affinity is compared within each category (Qloo's levels differ by
 * category), then score = relativeAffinity * (1 - popularity)^0.15. A popularity band drops
 * mega-stars and the barely known. Top `count`, spanning at least `minCategories` categories when
 * possible. Values and reasons: docs/tuning.md.
 *
 * Fallbacks, always labelled: if nothing passes the affinity floor, the best candidates that only
 * failed the floor are used. The popularity band is never relaxed.
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
  const { kept, dropped, rel } = screenRelative(
    pool,
    {
      maxPopularity: opts.maxPopularity ?? cfg.maxPopularity,
      minPopularity: opts.minPopularity ?? cfg.minPopularity,
      minRelativeAffinity: opts.minAffinity ?? cfg.minRelativeAffinity,
    },
    (c) => c.category,
  );
  const relOf = (c: { id: string }) => rel.get(c.id) ?? 0;
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
      reason: `No candidate passed the popularity band; ${droppedNote}.`,
    };
  }

  const scored = eligible
    .map((c) => ({
      id: c.id,
      category: c.category,
      score: nicheScore(Math.max(0, relOf(c)), c.popularity, cfg.popularityExponent),
      candidate: c,
    }))
    .sort(byScoreThenId);
  const chosen = pickDiverse(scored, count, minCategories);
  const categories = new Set(chosen.map((c) => c.category));

  const picks: PartnerPick[] = chosen.map(({ score, candidate }, i) => ({
    kind: "partner",
    rank: i + 1,
    score,
    confidence: relaxed ? "low" : confidenceFor(relOf(candidate)),
    entity: candidate,
    evidence: { affinity: candidate.affinity, popularity: candidate.popularity, relativeAffinity: relOf(candidate) },
  }));

  const summary = `Picked ${picks.length} from ${categories.size} ${plural(categories.size, "category", "categories")}; ${droppedNote}.`;
  if (relaxed) {
    return {
      picks,
      dropped,
      fallback: true,
      reason: `No candidate stood out within its category, so these are the closest. ${summary}`,
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

/**
 * Scores one partner the user chose (a pair from their roster), whether or not it made the
 * shortlist, with the same formula as scorePartners: affinity relative to its category's
 * candidates, times the mainstream discount. Outside the popularity band or below its category's
 * median it is kept but marked low confidence, with the reason. Null when it is not a candidate.
 */
export function scoreNamedPartner(
  candidates: readonly Candidate[],
  id: string,
  opts: Pick<ScorePartnersOptions, "excludeIds"> = {},
): { pick: PartnerPick; reason: string | null } | null {
  const cfg = ENGINE_CONFIG.partners;
  const exclude = new Set(opts.excludeIds ?? []);
  const pool = candidates.filter((c) => !exclude.has(c.id));
  const named = pool.find((c) => c.id === id);
  if (!named) return null;
  const { dropped, rel } = screenRelative(
    pool,
    { maxPopularity: cfg.maxPopularity, minPopularity: cfg.minPopularity, minRelativeAffinity: cfg.minRelativeAffinity },
    (c) => c.category,
  );
  const drop = dropped.find((d) => d.item.id === id)?.reason ?? null;
  // Outside the band it has no relative affinity among the screened; compare with its whole category.
  const relative = rel.get(id) ?? relativeAffinity(pool, (c) => c.category).get(id) ?? 0;
  const pick: PartnerPick = {
    kind: "partner",
    rank: 1,
    score: nicheScore(Math.max(0, relative), named.popularity, cfg.popularityExponent),
    confidence: drop ? "low" : confidenceFor(relative),
    entity: named,
    evidence: { affinity: named.affinity, popularity: named.popularity, relativeAffinity: relative },
  };
  return { pick, reason: drop ? describeDropped([{ item: named, reason: drop }]) : null };
}
