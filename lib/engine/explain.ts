import type { Category, Pick } from "./types";

export const CATEGORY_LABEL: Record<Category, string> = {
  artist: "artist",
  movie: "film",
  tv_show: "TV show",
  podcast: "podcast",
  person: "person",
  brand: "brand",
  videogame: "video game",
  book: "book",
  place: "place",
};

const n = (x: number) => x.toFixed(2);

/**
 * One plain sentence built only from fields on the pick. Never adds numbers of its own.
 * `fanbaseOnly`: cities ranked by the fanbase's heat alone (a solo takeover, or no partner heat).
 */
export function explain(pick: Pick, opts: { fanbaseOnly?: boolean } = {}): string {
  switch (pick.kind) {
    case "partner": {
      const { entity, evidence } = pick;
      return (
        `${entity.name} (${CATEGORY_LABEL[entity.category]}) ranks #${pick.rank} with a score of ` +
        `${n(pick.score)}, from affinity ${n(evidence.affinity)} (${n(evidence.relativeAffinity)} ` +
        `relative to its category) and popularity ${n(evidence.popularity)}, ${pick.confidence} confidence.`
      );
    }
    case "city":
      if (opts.fanbaseOnly) {
        return (
          `${pick.city.name}, ${pick.city.country} ranks #${pick.rank} with a score of ${n(pick.sA)} ` +
          `from the fanbase's heat alone and #${pick.populationRank} by population, ${pick.confidence} confidence.`
        );
      }
      return (
        `${pick.city.name}, ${pick.city.country} ranks #${pick.rank} with a combined score of ` +
        `${n(pick.combined)} (${n(pick.sA)} for the seed fanbase, ${n(pick.sB)} for the partner ` +
        `fanbase) and #${pick.populationRank} by population, ${pick.confidence} confidence.`
      );
    case "place": {
      const { matchedTags, requestedTags } = pick.evidence;
      let tags = "";
      if (matchedTags.length) tags = `, matching ${matchedTags.join(", ")}`;
      else if (requestedTags.length) tags = ", matching none of the requested tags";
      return (
        `${pick.place.name} ranks #${pick.rank} with affinity ${n(pick.evidence.affinity)}` +
        `${tags}, ${pick.confidence} confidence.`
      );
    }
    case "brand":
      return (
        `${pick.brand.name} ranks #${pick.rank} with a score of ${n(pick.score)}, from affinity ` +
        `${n(pick.evidence.affinity)} (${n(pick.evidence.relativeAffinity)} relative to the list) and ` +
        `popularity ${n(pick.evidence.popularity)}, ${pick.confidence} confidence.`
      );
  }
}
