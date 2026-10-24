import { ENGINE_CONFIG } from "./config";
import { byScoreThenId, confidenceFor, describeDropped, nicheScore, screen } from "./shared";
import type { Brand, BrandPick, Place, PlacePick, RankResult } from "./types";

/**
 * Ranks venues by affinity, weighted by how many of the requested tags each place carries.
 * Places are not popularity-discounted: a well-known venue is a feature, not bias.
 */
export function rankPlaces(
  results: readonly Place[],
  tags: readonly string[],
): RankResult<PlacePick, Place> {
  const cfg = ENGINE_CONFIG.places;
  const { kept, dropped } = screen(results, { maxPopularity: 1, minAffinity: cfg.minAffinity });
  const requested = [...new Set(tags.map(normaliseTag))];

  const picks = kept
    .map((place) => {
      const have = new Set(place.tags.map(normaliseTag));
      const matchedTags = requested.filter((t) => have.has(t));
      const match = requested.length ? matchedTags.length / requested.length : 1;
      const score = place.affinity * (cfg.tagBaseWeight + (1 - cfg.tagBaseWeight) * match);
      return { id: place.id, score, place, matchedTags };
    })
    .sort(byScoreThenId)
    .slice(0, cfg.count)
    .map(
      ({ score, place, matchedTags }, i): PlacePick => ({
        kind: "place",
        rank: i + 1,
        score,
        confidence:
          requested.length && matchedTags.length === 0 ? "low" : confidenceFor(place.affinity),
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
        ? `No venue passed the affinity floor; ${droppedNote}.`
        : "No venues were returned for this city.",
    };
  }
  const anyMatch = requested.length === 0 || picks.some((p) => p.evidence.matchedTags.length > 0);
  if (!anyMatch) {
    return {
      picks,
      dropped,
      fallback: true,
      reason: `No venue matched the requested tags, so these are ranked by affinity alone; ${droppedNote}.`,
    };
  }
  return { picks, dropped, fallback: false, reason: `Ranked ${picks.length} venues; ${droppedNote}.` };
}

/** Ranks sponsor brands with the same niche score and bias guard as partners. */
export function rankBrands(results: readonly Brand[]): RankResult<BrandPick, Brand> {
  const cfg = ENGINE_CONFIG.brands;
  const { kept, dropped } = screen(results, cfg);

  const picks = kept
    .map((brand) => ({
      id: brand.id,
      score: nicheScore(brand.affinity, brand.popularity, cfg.popularityExponent),
      brand,
    }))
    .sort(byScoreThenId)
    .slice(0, cfg.count)
    .map(
      ({ score, brand }, i): BrandPick => ({
        kind: "brand",
        rank: i + 1,
        score,
        confidence: confidenceFor(brand.affinity),
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

function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase();
}
