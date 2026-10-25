import { ENGINE_CONFIG, NON_SPONSOR_BRAND_TYPES } from "./config";
import { byScoreThenId, describeDropped, nicheScore, screen } from "./shared";
import type { Brand, BrandPick, Confidence, Place, PlacePick, RankResult } from "./types";

/**
 * Ranks places by affinity. Requested tags are alternatives ("music venue" or "concert hall"):
 * a place carrying none of them keeps only `tagBaseWeight` of its score.
 * Places are not popularity-discounted: a well-known venue is a feature, not bias.
 */
export function rankPlaces(
  results: readonly Place[],
  tags: readonly string[],
  count: number = ENGINE_CONFIG.places.count,
): RankResult<PlacePick, Place> {
  const cfg = ENGINE_CONFIG.places;
  const { kept, dropped } = screen(results, { maxPopularity: 1, minAffinity: cfg.minAffinity });
  const requested = [...new Set(tags.map(normaliseTag))];

  const ranked = kept
    .map((place) => {
      const have = new Set(place.tags.map(normaliseTag));
      const matchedTags = requested.filter((t) => have.has(t));
      const matches = requested.length === 0 || matchedTags.length > 0;
      const score = place.affinity * (matches ? 1 : cfg.tagBaseWeight);
      return { id: place.id, score, place, matchedTags, matches };
    })
    .sort(byScoreThenId)
    .slice(0, count);

  const picks = ranked.map(
    ({ score, place, matchedTags, matches }, i): PlacePick => ({
      kind: "place",
      rank: i + 1,
      score,
      confidence: matches ? rankConfidence(i, ranked, kept.length) : "low",
      place,
      evidence: {
        affinity: place.affinity,
        popularity: place.popularity,
        matchedTags,
        requestedTags: requested,
      },
    }),
  );

  const droppedNote = describeDropped(dropped);
  if (picks.length === 0) {
    return {
      picks,
      dropped,
      fallback: true,
      reason: results.length
        ? `No place passed the affinity floor; ${droppedNote}.`
        : "No places were returned for this city.",
    };
  }
  if (!ranked.some((r) => r.matches)) {
    return {
      picks,
      dropped,
      fallback: true,
      reason: `No place matched ${requested.join(" or ")}, so these are ranked by affinity alone; ${droppedNote}.`,
    };
  }
  return { picks, dropped, fallback: false, reason: `Ranked ${picks.length} places; ${droppedNote}.` };
}

/** Ranks sponsor brands with the same niche score and bias guard as partners. */
export function rankBrands(
  results: readonly Brand[],
  count: number = ENGINE_CONFIG.brands.count,
): RankResult<BrandPick, Brand> {
  const cfg = ENGINE_CONFIG.brands;
  // Nonprofits and government programmes are not sponsors (Qloo brand_type).
  const notSponsors = results.filter((b) => b.brandTypes?.some((t) => NON_SPONSOR_BRAND_TYPES.includes(t)));
  const screened = screen(
    results.filter((b) => !notSponsors.includes(b)),
    cfg,
  );
  const kept = screened.kept;
  const dropped = [...notSponsors.map((item) => ({ item, reason: "not_a_sponsor" as const })), ...screened.dropped];

  const ranked = kept
    .map((brand) => ({
      id: brand.id,
      score: nicheScore(brand.affinity, brand.popularity, cfg.popularityExponent),
      brand,
    }))
    .sort(byScoreThenId)
    .slice(0, count);

  const picks = ranked.map(
    ({ score, brand }, i): BrandPick => ({
      kind: "brand",
      rank: i + 1,
      score,
      confidence: rankConfidence(i, ranked, kept.length),
      brand,
      evidence: { affinity: brand.affinity, popularity: brand.popularity },
    }),
  );

  const droppedNote = describeDropped(dropped);
  if (picks.length === 0) {
    return {
      picks,
      dropped,
      fallback: true,
      reason: results.length
        ? `No brand passed the bias guard and affinity floor; ${droppedNote}.`
        : "No brands were returned.",
    };
  }
  return { picks, dropped, fallback: false, reason: `Ranked ${picks.length} brands; ${droppedNote}.` };
}

/**
 * More qualifying results means more confidence; a near tie at the top means less confidence
 * in which one is first.
 */
function rankConfidence(
  index: number,
  ranked: readonly { score: number }[],
  qualified: number,
): Confidence {
  const cfg = ENGINE_CONFIG.rankConfidence;
  let level = 0;
  if (qualified >= cfg.highCount) level = 2;
  else if (qualified >= cfg.mediumCount) level = 1;
  if (index === 0 && ranked.length > 1 && ranked[0].score > 0) {
    const gap = (ranked[0].score - ranked[1].score) / ranked[0].score;
    if (gap < cfg.minRelativeGap) level = Math.max(0, level - 1);
  }
  return (["low", "medium", "high"] as const)[level];
}

function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase();
}
