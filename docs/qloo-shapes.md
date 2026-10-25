# Qloo response shapes we rely on

Recorded from the hackathon API (`https://hackathon.api.qloo.com`) on 25 Oct 2026 with
`npm run probe` and `scripts/probe-extra.ts`. Raw responses are in `tests/fixtures/` locally
(gitignored: they are Qloo data); a trimmed copy for tests is committed in `tests/fixtures/qloo/`.
Only the fields below are read by `lib/qloo/api.ts`.

## Transport

- Auth: header `X-Api-Key`. Base URL is the host root; paths are `/search`, `/v2/insights`, `/v2/tags`.
- Limits, from response headers: `x-month-ratelimit-limit: 50000`, `x-second-ratelimit-limit: 10`,
  with `-remaining` and `-reset` (seconds) variants. The client records
  `x-month-ratelimit-remaining` on every call.
- Errors are JSON: `{"errors":[{"message": "...", "path": "..."}]}` with HTTP 400 for bad
  parameters or unusable signals. No results is `200` with an empty list, not 404.
- Latency: search 0.3–2 s; entity insights 0.5–2 s; heatmaps 2–7 s; one tags lookup and one
  locality insight exceeded the 8 s timeout.

## `GET /search?query=…&types=…&take=…`

```
{ results: [ {
    entity_id: string,                      // UUID
    name: string,
    types: ["urn:entity:person"],           // one type per result
    popularity?: number,                    // 0–1 percentile; absent on some results
    disambiguation?: string,                // e.g. "2025", "1999-05-11", an address
    properties: {
      short_description?: string,           // "American actor and comedian"
      image?: { url: string },
      citizenship?: string[],               // people: ["United States of America"]
      release_country?: string,             // films and shows: "United States"
      release_year?: number,
      …                                     // many more, unused
    },
    tags?: [{ id, name, type }],
    location?: { lat, lon }                 // places and localities only
} ] }
```

- `types` filters results (comma-separated URNs). Without it, places, localities and albums crowd
  the list: "asdfgh" matched a place named "asdfgh"; "Arsenal" returned a video game, a band and
  four localities before the club.
- Famous people come back twice with the same name: a `person` and an `artist` (John Mulaney,
  Sabrina Carpenter, Billie Eilish), popularity within 0.003 of each other.
- Sports clubs are `urn:entity:brand` ("Arsenal F.C.", "Golden State Warriors", "Manchester
  United F.C."), described as "a professional football club based in London…".
- Comedians are `urn:entity:person` (short description "American actor and comedian"); musicians
  are both `person` and `artist`.
- A misspelling ("Billie Elish") returns the intended entity first ("Billie Eilish").

## `GET /v2/insights` with `filter.type=urn:entity:<category>` (partners, opener, brands)

Params: `signal.interests.entities` (comma-separated ids, several allowed), `take`, optional
`signal.location.query`.

```
{ success: true,
  results: { entities: [ {
    entity_id, name,
    type: "urn:entity",                     // generic on every insights result
    subtype: "urn:entity:podcast",          // the real type
    popularity: number,                     // 0–1 percentile
    query: { affinity: number, measurements?: { audience_growth } },   // affinity 0–1
    properties: { short_description?, image?: { url }, brand_type?: string[], … },
    tags?: [{ id, name, type }]
  } ] },
  query?: { localities?: … }               // echo of resolved location filters
}
```

- Affinity and popularity are both compressed near 1 for well-known entities: comedy podcasts for
  John Mulaney score affinity 0.91–0.97 with popularity 0.94–0.99.
- Brands carry `properties.brand_type`: "Media Brand", "Nonprofit Brand", "Government Brand", ….
- Signals of type `place` or `locality` are rejected: "All of the provided
  signal.interests.entities were invalid" (HTTP 400).
- `filter.type=urn:entity:locality` with a person signal is rejected or times out; cities come
  from heatmaps instead.

## `GET /v2/insights` with `filter.type=urn:heatmap`

Requires a location: `filter.location.query` (a country name works: "United States", "United
Kingdom"). Without it: 400 "at least one valid signal and filter.location or
filter.location.query is required for heatmap insight".

```
{ results: { heatmap: [ {
    location: { latitude, longitude, geohash },   // geohash of length 4 (~40 × 20 km)
    query: { affinity, affinity_rank, popularity, … }
} ] } }
```

- About 7,600 (UK) to 9,900 (US incl. territories) cells per call.
- `affinity` is a percentile across the returned cells (quartiles exactly 0.25 / 0.5 / 0.75), so
  it measures over-indexing, not raw audience size.
- Works for any fanbase type tried: person, podcast, brand.

## `GET /v2/insights` with `filter.type=urn:entity:place`

Params: `signal.interests.entities`, `filter.location.query` (a city name), `filter.tags`
(comma-separated tag ids, matched as any-of), `take`.

```
results.entities[]: {
  entity_id, name, popularity,
  query: { affinity },
  location: { lat, lon, geohash },
  properties: { address, short_description, … },
  tags: [{ id: "urn:tag:category:place:comedy_club", name: "Comedy club", type }]
}
```

- No capacity, dates or prices in anything we read; the app keeps showing "to confirm with the
  promoter".

## `GET /v2/tags?filter.query=…&filter.parents.types=urn:entity:place`

`results.tags[]: { id, name, type, popularity, parents }`. Place-type ids we use:

| Readable | Tag id |
|---|---|
| comedy club | `urn:tag:category:place:comedy_club` |
| live music venue | `urn:tag:category:place:live_music_venue` |
| concert hall | `urn:tag:category:place:concert_hall` |
| performing arts theater | `urn:tag:category:place:performing_arts_theater` |
| movie theater | `urn:tag:category:place:movie_theater` |
| stadium | `urn:tag:category:place:stadium` |
| arena | `urn:tag:category:place:arena` |
| sports bar | `urn:tag:category:place:sports_bar` |
| bar | `urn:tag:category:place:bar` |
| pub | `urn:tag:category:place:pub` |
| cafe | `urn:tag:category:place:cafe` |
| night club | `urn:tag:category:place:night_club` |
| book store | `urn:tag:category:place:book_store` |
| convention center | `urn:tag:category:place:convention_center` |
