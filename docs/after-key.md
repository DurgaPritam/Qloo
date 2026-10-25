# Qloo assumptions: checked against the real API

Every assumption made while building without a key, checked on 25 Oct 2026 against real responses
(`npm run probe`, `scripts/probe-extra.ts`; shapes in `docs/qloo-shapes.md`, judgement calls in
`docs/decisions.md`, thresholds in `docs/tuning.md`).

Status: ✅ confirmed · ❌ wrong, fixed (how) · ➖ not testable here (why).

## Still to do

- [ ] Real screenshots in the README from live runs (step 8).
- [ ] Audience profile card (age and gender skew, top taste tags). Needs a Claude Design pass
  first (new component) and a probe of Qloo's demographics data.
- [ ] Entity images in the crossover cards (images exist: S5). The picker already shows them.
- [ ] `scripts/warm-cache.ts` and the preloaded examples (step 7).

## Transport and auth

| # | Assumption | Status and evidence |
|---|---|---|
| T1 | Auth is a single `X-Api-Key` header. | ✅ Every call in both probes succeeded with the header alone. |
| T2 | Base URL is a host root; paths `/search`, `/v2/insights`, `/v2/tags`. | ✅ No 404s on any path. |
| T3 | Unknown entities give 200 with empty results, not 404. | ❌ Unusable signals give **400** "All of the provided signal.interests.entities were invalid" (place/locality ids). Fixed: search only returns fanbase types, so such ids never reach insights; the agent's error path labels any 400. |
| T4 | 429 may carry `Retry-After`. | ❌ Qloo sends `x-second-ratelimit-reset` (seconds) and per-month/per-second limit headers. Fixed: the client retries using either header and records the monthly remaining quota. Not triggered in testing. |
| T5 | Error bodies never echo the key. | ✅ All 22 failed calls' bodies checked; the client also redacts. |

## Search (`/search`)

| # | Assumption | Status and evidence |
|---|---|---|
| S1 | Params `query` and optional `types`. | ✅ `types` filters results (`extra/search-typed-*.json`). Now always sent, limited to fanbase types. |
| S2 | `{ results: [...] }`, best match first. | ✅ |
| S3 | Results have `entity_id`, `name`, `types[]`. | ✅ One type per result. |
| S4 | `popularity` on each result, 0–1. | ❌ Missing on some results (e.g. "asdfgh", a film special). Fixed: missing popularity maps to 0 for search, and to invalid (dropped) for insights. |
| S5 | Image at `properties.image.url`. | ✅ `https://images.qloo.com/…`. |
| S6 | A misspelling returns the intended entity first. | ✅ "Billie Elish" → Billie Eilish first; offered as "did you mean". |
| S7 | Nonsense returns an empty list. | ❌ Untyped search returned a **place** named "asdfgh". Fixed: typed search returns nothing for "asdfgh". |
| S8 | Comedians, podcasts and teams map to our categories. | ✅ Comedians are `person`, podcasts `podcast`, clubs `brand` ("Arsenal F.C.", "Golden State Warriors", "Manchester United F.C."). |

## Insights for partner candidates

| # | Assumption | Status and evidence |
|---|---|---|
| I1 | `filter.type`, `signal.interests.entities`, `take`. | ✅ |
| I2 | All seven categories are valid `filter.type` values. | ✅ No category-related errors for valid signals. |
| I3 | `{ success, results: { entities } }`. | ✅ But each entity's `type` is the generic `urn:entity`; the real type is in `subtype`. Fixed in `lib/qloo/map.ts`. |
| I4 | `query.affinity`, 0–1. | ✅ |
| I5 | Popularity is a percentile, so `> 0.97` means near-universal reach. | ❌ Percentile, but bunched near 1: median partner popularity is 0.966, p90 0.998. A 0.97 cut drops half of every list. Fixed in step 4 (`docs/tuning.md`). |
| I6 | Affinity is comparable across categories. | ❌ Medians differ by category (TV shows 0.947, podcasts 0.899, video games 0.855). Fixed in step 4: affinity is compared within each category before ranking. |
| I7 | `minAffinity = 0.3` is a sensible floor. | ❌ Every returned partner scores 0.81–0.99. Fixed in step 4. |
| I8 | Confidence high ≥ 0.7, medium ≥ 0.4 on affinity. | ❌ Everything would be "high". Fixed in step 4. |

## Heatmap

| # | Assumption | Status and evidence |
|---|---|---|
| H1 | Works without a location and returns global cells. | ❌ 400 "filter.location or filter.location.query is required for heatmap insight". Fixed: cities are ranked inside a market (country), passed as `filter.location.query` (decisions D7). |
| H2 | `{ results: { heatmap } }`. | ✅ |
| H3 | Cells have `location.latitude/longitude/geohash`. | ✅ Geohash length 4. |
| H4 | Cells have `query.affinity`, 0–1. | ✅ It is a percentile across the returned cells (quartiles exactly 0.25/0.5/0.75). |
| H5 | ≥ 3 cells within 40 km of a major city. | ✅ 8–10 cells near New York, Chicago, Los Angeles, Austin and Boise. |
| H6 | Mean cell affinity near a city is a fair city heat; per-entity normalisation removes scale. | ✅ Because affinity is already a percentile per heatmap. Checked on real runs in step 4. |

## Places and brands

| # | Assumption | Status and evidence |
|---|---|---|
| P1 | Places: `filter.type=urn:entity:place`, `filter.location.query`, `filter.tags`. | ✅ "Chicago" resolves; several tags combine as any-of. |
| P2 | Tag ids `urn:tag:genre:place:music_venue`, `…:bar`. | ❌ Those returned nothing. Fixed: real ids from `/v2/tags` (`urn:tag:category:place:comedy_club`, `…:live_music_venue`, …) in `lib/qloo/tags.ts`. |
| P3 | Places carry affinity, popularity and named tags. | ✅ Tag names like "Comedy club", "Live music venue". |
| P4 | Coordinates and address; never capacity, dates or prices. | ✅ `location.lat/lon`, `properties.address`. No capacity, dates or prices in anything we read. |
| P5 | Brands with the city as `signal.location.query`. | ✅ |
| P6 | Brands carry affinity and popularity, so the same bias guard applies. | ✅ But the list includes nonprofits and government programmes (ACLU, TSA PreCheck). Fixed: brands with `brand_type` "Nonprofit Brand" or "Government Brand" are not offered as sponsors. |

## Matching and formats

| # | Assumption | Status and evidence |
|---|---|---|
| M1 | Same name in several categories; popularity ratio 0.8 tells the famous one apart. | ❌ Popularity is bunched near 1, so a ratio never separates them; and famous people appear twice (person + artist). Fixed: compare distance from 1 (`match.dominanceFactor` 5), merge person/artist pairs by Qloo's description, fold club suffixes ("F.C."). |
| M2 | The intended entity is among a misspelling's results. | ✅ |
| M3 | Comedians resolve as `person`, teams as `brand`. | ✅ Musicians are both person and artist; the artist is kept unless Qloo's description says comedian. |
| M4 | Place tags matched by readable names. | ✅ With the real names ("live music venue", "performing arts theater", "book store"). |
| M5 | `candidates` can be scoped to a city for an opener or host. | ✅ `signal.location.query=Chicago` returns comedians with Chicago links (`extra/artists-near-chicago.json`). |
| M6 | A descriptive field for the picker. | ✅ `properties.short_description` ("American actor and comedian") and `disambiguation` (a year or birth date). The picker now shows them instead of popularity. |

## Agent calls

| # | Assumption | Status and evidence |
|---|---|---|
| A1 | A heatmap works for any category. | ✅ Person, podcast and brand heatmaps all returned. |
| A2 | Two ids in `signal.interests.entities`. | ✅ Places and brands with fanbase + partner. |
| A3 | Population rank among overlapping cities is a fair baseline. | ✅ Checked on real runs in step 4. |
| A4 | Uncached runs fit in about 11–15 calls. | ✅ Search 1, partners 4–6, heatmaps 2, room 4–5. Measured on real runs in step 6. |

## Not from Qloo

| # | Assumption | Status |
|---|---|---|
| N1 | GeoNames cities ≥ 100k, folded into metros within 40 km. | ✅ Now filtered to the market's country before scoring. |
| N2 | `filter.location.query` accepts "City, Region, CC". | ❌ Not tested in that form; Qloo resolved "Chicago" and "London". Fixed: the query is "City, Region" (e.g. "Chicago, Illinois") without the code. |
