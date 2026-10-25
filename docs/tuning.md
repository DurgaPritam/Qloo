# Engine tuning on real Qloo data

Tuned on 25 Oct 2026 with `scripts/tune.mts`, offline on the probe responses (no extra Qloo
calls): 120 partner candidates for each of seven fanbases, brand lists for nine, and real US and
UK heatmaps. All values live in `lib/engine/config.ts`.

## What the data showed

| Measure (720 partner candidates) | Value |
|---|---|
| Affinity range | 0.81–0.99, median 0.92 |
| Affinity median by category | TV show 0.947, artist 0.956, brand 0.926, movie 0.913, person 0.921, podcast 0.899, video game 0.855 |
| Popularity quartiles | 0.891 / 0.966 / 0.992; p90 0.998; p99 0.9998 |
| Popularity median by category | TV show 0.68; all others 0.88–0.997 |
| Share above the old 0.97 cut | about half |

Mega-stars and generic platforms sit at 0.999 and above: YouTube and Netflix (0.9999), Victoria's
Secret, Rihanna (0.9999), Mercedes-Benz (0.9998). Many junk entries have popularity exactly 0 (a
"World Series of Poker Game" brand, an "Antonio Banderas" fragrance brand).

## Partner scoring

| Setting | Before | After | Why |
|---|---|---|---|
| Formula | `affinity × (1 − popularity)^0.5` | `relative affinity × (1 − popularity)^0.15` | Raw affinity differs by category and TV shows' low popularity made them win everything. |
| Relative affinity | — | 0 at the category's median candidate, 1 at its best; computed after the popularity band | Compares each candidate with its own category's level. |
| Affinity floor | 0.3 raw | above the category median | 0.3 dropped nothing (minimum seen 0.81). |
| Popularity ceiling (bias guard) | 0.97 | 0.999 | 0.97 is the median; 0.999+ is where the mega-stars are. |
| Popularity floor | none | 0.5 | Popularity 0 entries topped every list; a partner must be able to draw a crowd. |
| Popularity exponent | 0.5 | 0.15 | A gentle discount that separates near-ties without rewarding obscurity. |
| Confidence | on raw affinity, high ≥ 0.7, medium ≥ 0.4 | on relative affinity, same cut-offs | Raw affinity made everything "high". |
| Shortlist | 3 from ≥ 2 categories | unchanged | Met in every example. |

### Before and after

| Fanbase | Before (old rules) | After |
|---|---|---|
| John Mulaney | World Series of Poker Game (brand, popularity 0), I Love That for You (TV), Rutherford Falls (TV) | Mythic Quest (TV), Oh, Hello: the P'dcast (podcast), Rainbow Kitten Surprise (artist) |
| Sabrina Carpenter | Antonio Banderas (brand, popularity 0), The Way Home (TV), The Kardasim Podcast | Anne with an E (TV), Very Really Good (podcast), Marvel's Guardians of the Galaxy (video game) |
| Sinners | South of Hell (TV), Superstition (TV), Margo Martindale | Outcast (TV), Jessica Chastain (person), Sibling Revelry (podcast) |
| Call Her Daddy | Bump (TV), More Labs (brand), Greenhouse Academy (TV) | White Claw (brand), Hannah Ann Sluss (person), Outer Banks (TV) |
| Arsenal F.C. | We Are Newcastle United (TV), When Eagles Dare: Crystal Palace F.C. (TV), Iverson (film) | All or Nothing: Arsenal (TV), Coach Carter (film), Jack Wilshere (person) |
| Billie Eilish | Antonio Banderas (brand, popularity 0), Can't Cope, Won't Cope (TV, 0), Cheaters (TV) | High Fidelity (TV), Camping (TV), Genshin Impact (video game) |
| Black Country, New Road | Three Busy Debras (TV), Welcome to Flatch (TV), Jamie Isaac | Joe Pera Talks with You (TV), King Krule (person), Rough Trade (brand) |

Success checks: no mega-star (popularity > 0.999) tops any list ✓; six of seven shortlists span
three categories and the seventh two ✓; before, 6 of 7 lists were led by a TV show or a
popularity-0 entry.

## Sponsors

| Setting | Before | After | Why |
|---|---|---|---|
| Formula | `affinity × (1 − popularity)^0.5` | `relative affinity (within the list) × (1 − popularity)^0.15` | Same reasons as partners. |
| Popularity ceiling | 0.97 | 0.9995 | Real sponsors are big brands; only the very top (Victoria's Secret, Starbucks, Netflix) is excluded. Before, 24 of 25 brands were dropped for Arsenal. |
| Popularity floor | none | 0.5 | |
| Excluded types | none | Qloo `brand_type` "Nonprofit Brand", "Government Brand" | ACLU, Planned Parenthood and TSA PreCheck were in real lists. |

After: comedy (Mulaney + Oh, Hello, Chicago) → Buzzfeed, NPR, The Onion; Sabrina Carpenter →
Topshop, Kate Spade New York, ASOS; Black Country, New Road → Rough Trade, Universal Works, Norse
Projects; Billie Eilish → Fendi, Burberry, Givenchy.

## Cities

| Setting | Value | Why |
|---|---|---|
| Market | the fanbase's home country (Qloo properties), else US | Heatmaps need a location (decisions D7). |
| Radius | 40 km | 8–10 cells within 40 km of each test city; geohash cells are ~40 × 20 km. |
| Minimum population | tour stop / live show 250k, screening tour 150k, fan fest 300k (unchanged) | At 150k a comedy tour's top five were Worcester, Springfield and Providence; at 250k Boston, Portland, Seattle, Buffalo, Milwaukee. |

Mulaney × Oh, Hello (US, 250k): Boston #1 (population rank 22), Portland #2 (23), Seattle #3
(17), Buffalo #4 (66), Milwaukee #5 (30). Population alone picks New York. Arsenal (UK): London
#1, then Southend-on-Sea, Brighton, Reading, Milton Keynes. Qloo rank differs from population rank
for 4–5 of the top 5 in every example ✓.

## Venues

Venue tags are alternatives, but the first listed is preferred (each later tag × 0.9, floor 0.7),
and rooms tagged stadium or arena are weighted × 0.5 outside fan fests. Before, a podcast live
show was placed in U.S. Bank Stadium because it carries a "live music venue" tag.
