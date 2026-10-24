# Check after the Qloo key arrives

Everything below is an **assumption** made while building without a key. When the probe has run
(`npm run probe`, fixtures in `tests/fixtures/`), check each item against the real responses, tick
it or correct the code it points to, then write `docs/qloo-shapes.md` and implement
`lib/qloo/api.ts` (`QlooApiSource`), which is a stub until then.

How to check: open `tests/fixtures/probe-summary.json` (field paths, failed calls) and the raw
fixture named in each row.

## Transport and auth

| # | Assumption | Used in | Check in |
|---|---|---|---|
| T1 | Auth is a single `X-Api-Key` header; no query-string key. | `lib/qloo/client.ts` | any call succeeds |
| T2 | `QLOO_BASE_URL` is a host root (e.g. the hackathon host) and paths are `/search`, `/v2/insights`, `/v2/tags`. | client, probe | probe has no 404s on these paths |
| T3 | Unknown entity ids give 200 with empty results, not 404. Client maps 404 to `NotFoundError` either way. | client, agent fallbacks | probe `nonsense` row |
| T4 | 429 may carry `Retry-After` in seconds. | client retry | only visible under rate limiting |
| T5 | Error bodies never echo the API key (the client redacts anyway). | client | failed-call messages in summary |

## Search (`/search`)

| # | Assumption | Used in | Check in |
|---|---|---|---|
| S1 | Params are `query` and optional `types` (comma-separated `urn:entity:*`). | `QlooSource.searchEntities` | `search/*.json` |
| S2 | Response is `{ results: [...] }`, best match first. | probe (top result = `results[0]`) | `search/*.json` |
| S3 | Each result has `entity_id`, `name`, `types: string[]` (e.g. `urn:entity:artist`). | mapping to `Entity.id/name/category` | `search/*.json` |
| S4 | `popularity` is on each result, 0–1. | `Entity.popularity` | summary `fields.popularity` |
| S5 | An image URL lives at `properties.image.url`. | `Entity.imageUrl` | summary `fields.images` |
| S6 | A misspelling ("Beyonse") still returns the intended entity first. | agent search step | `search/misspelled.json` |
| S7 | A nonsense string returns an empty `results` array (not an error). | mock mirrors this; agent fallback | `search/nonsense.json` |
| S8 | A comedian, podcast and sports team each map to one of our `Category` values. Which `urn:entity:*` they use is unknown. | `Category` union in `lib/engine/types.ts` | `search/{comedian,podcast,sports-team}.json` |

## Insights (`/v2/insights`) for partner candidates

| # | Assumption | Used in | Check in |
|---|---|---|---|
| I1 | Params `filter.type=urn:entity:<category>`, `signal.interests.entities=<ids>` (comma-separated), `take`. | `QlooSource.candidates` | `insights/*/*.json` |
| I2 | Category names `artist, movie, tv_show, podcast, person, brand, videogame` are all valid `filter.type` values. | probe, `Category` | failed calls in summary |
| I3 | Response is `{ success, results: { entities: [...] } }`. | mapping | `insights/*/*.json` |
| I4 | Each entity has `query.affinity`, 0–1, higher = stronger over-index. | `Candidate.affinity` | summary `fields.affinity` |
| I5 | Each entity has `popularity`, 0–1, as a percentile, so `> 0.97` means near-universal reach. | bias guard `partners.maxPopularity` | distribution in fixtures |
| I6 | Affinity is comparable **across categories** for the same seed, so one ranking can mix artists, films and podcasts. | `scorePartners` | compare ranges across `insights/<name>/*.json` |
| I7 | Typical affinity values make `minAffinity = 0.3` a sensible floor. | `ENGINE_CONFIG.partners.minAffinity` | distribution in fixtures |
| I8 | Confidence thresholds high ≥ 0.7, medium ≥ 0.4 on affinity are meaningful. | `ENGINE_CONFIG.confidence` | distribution in fixtures |

## Heatmap (`/v2/insights`, `filter.type=urn:heatmap`)

| # | Assumption | Used in | Check in |
|---|---|---|---|
| H1 | Works with only `signal.interests.entities`, no location filter, and returns global cells. | `QlooSource.heatmap`, probe | `heatmap/*.json` or failed calls |
| H2 | Response is `{ results: { heatmap: [...] } }`. | mapping | `heatmap/*.json` |
| H3 | Each cell has `location.latitude`, `location.longitude` (and `location.geohash`). | `HeatCell.lat/lon/geohash` | summary `fields.location` |
| H4 | Each cell has `query.affinity`, 0–1. | `HeatCell.affinity` | summary `fields.affinity` |
| H5 | Cells are dense enough that ≥ 3 fall within 40 km of a major city. | `cities.radiusKm`, `cities.minCellsForHigh` | count cells near a known city |
| H6 | The mean of cell affinities near a city is a fair city heat. Normalising per entity removes scale differences between two entities' heatmaps. | `scoreCities` | sanity-check top cities for `music-artist` |

## Places and brands

| # | Assumption | Used in | Check in |
|---|---|---|---|
| P1 | Places use `filter.type=urn:entity:place`, `filter.location.query=<city name>`, optional `filter.tags`. | `QlooSource.places` | `places/*/{venues,bars}.json` |
| P2 | Tag ids are `urn:tag:genre:place:music_venue` and `urn:tag:genre:place:bar`. These are guesses; `/v2/tags?filter.query=…` should give the real ones. | probe `PLACE_TAGS` | `tags/*.json` |
| P3 | Places carry `query.affinity`, `popularity` and `tags[]` (with `name` or `tag_id`) to match against. | `Place`, `rankPlaces` tag matching | `places/*/*.json` |
| P4 | Places carry coordinates and an address under `location`/`properties`. Never capacity, dates or prices; those stay "to confirm with the promoter". | `Place.lat/lon/address` | `places/*/*.json` |
| P5 | Brands use `filter.type=urn:entity:brand` with the city as `signal.location.query` (a signal, not a filter). | `QlooSource.brands` | `places/*/brands.json` |
| P6 | Brands carry `query.affinity` and `popularity` 0–1, so the same bias guard applies. | `rankBrands` | `places/*/brands.json` |

## Matching and formats

| # | Assumption | Used in | Check in |
|---|---|---|---|
| M1 | Qloo search can return the same name in several categories (artist and film). Popularity tells the famous one apart (ratio 0.8). | `classifyMatches`, `ENGINE_CONFIG.match` | `search/*.json` |
| M2 | For a misspelling, the intended entity is among the results, so "did you mean" can offer it. | `classifyMatches` | `search/misspelled.json` |
| M3 | Comedians resolve as `person`, teams as `brand` (or a type we add to `Category`). | `FORMAT_BY_CATEGORY` | S8 |
| M4 | Place tags can be matched by readable names ("music venue", "comedy club", "movie theater", "sports bar"). The real source maps these to Qloo tag ids. | `FORMAT_BY_CATEGORY.*.venueTags/spotTags`, `rankPlaces` | `tags/*.json`, P2/P3 |
| M5 | `candidates` can be scoped to a city to find a local opener or host. | `QlooSource.candidates(…, location)` | add a probe call |

## Agent calls

| # | Assumption | Used in | Check in |
|---|---|---|---|
| A1 | A heatmap works for an entity of any category (the partner may be a podcast or TV show). | `pick_city` | add a probe heatmap call for a podcast id |
| A2 | `signal.interests.entities` accepts two ids (fanbase + partner) for places, brands and local talent. | `plan_room` | add a probe call with two ids |
| A3 | When both audiences have some heat in most large cities, "population rank among overlapping cities" is still a fair "without Qloo" baseline. | `pick_city` second pass | `populationPick` on real runs |
| A4 | Uncached runs fit in about 11–15 Qloo calls (search 1, partners 4–6, heatmaps 2, room 4–5), well under the 25 cap. | budget | `plan.qlooCalls` on real runs |

## Not from Qloo

| # | Assumption | Used in |
|---|---|---|
| N1 | City list is GeoNames cities15000, population ≥ 100k (`lib/engine/data/cities.json`), folded into metros within 25 km. | `scoreCities` input, `metroCities`, populationRank |
| N2 | `filter.location.query` accepts a plain "City, Region, CC" string built from that list. | places, brands |
