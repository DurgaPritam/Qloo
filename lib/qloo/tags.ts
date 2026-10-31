/** Readable place tags (lib/engine/config.ts) to Qloo tag ids, from /v2/tags. */
export const PLACE_TAG_IDS: Readonly<Record<string, string>> = {
  "comedy club": "urn:tag:category:place:comedy_club",
  "live music venue": "urn:tag:category:place:live_music_venue",
  "concert hall": "urn:tag:category:place:concert_hall",
  "performing arts theater": "urn:tag:category:place:performing_arts_theater",
  "movie theater": "urn:tag:category:place:movie_theater",
  stadium: "urn:tag:category:place:stadium",
  arena: "urn:tag:category:place:arena",
  "sports bar": "urn:tag:category:place:sports_bar",
  bar: "urn:tag:category:place:bar",
  pub: "urn:tag:category:place:pub",
  cafe: "urn:tag:category:place:cafe",
  "night club": "urn:tag:category:place:night_club",
  "book store": "urn:tag:category:place:book_store",
  "convention center": "urn:tag:category:place:convention_center",
};

export function placeTagIds(names: readonly string[] | undefined): string[] {
  return (names ?? []).map((n) => PLACE_TAG_IDS[n.toLowerCase()]).filter((id): id is string => Boolean(id));
}
