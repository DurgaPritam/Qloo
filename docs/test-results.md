# Test results on the real Qloo API

Local runs against `https://hackathon.api.qloo.com` (`scripts/run-real.mts`,
`scripts/fallbacks.mts`). Planner: scripted (no Anthropic key configured yet), so brief and email
wording is the template; every number, pick and route is the same as with Claude, because those
come from code. Quota counts are from Qloo's `x-month-ratelimit-remaining`.

## Fallbacks (step 5, 25 Oct 2026)

| Fallback | Input | Fired on real data? | What happened |
|---|---|---|---|
| Ambiguous name | "Mercury" | ✅ | Picker: Mercury (video game, with Qloo's description) and Mercury (band). Choosing the band resumed with `overrides.entityId` and completed. |
| No match | "asdfgh" | ✅ | "We couldn't find a fanbase called “asdfgh”." (typed search returns nothing). |
| Misspelling | "Billie Elish" | ✅ | "Did you mean Billie Eilish or Billie Holiday or Billie Faiers?", each with Qloo's description. |
| Thin heatmap → regional overlap | Mercury (band) | ✅ | "Not enough city-level data, so I'm widening to regional overlap." Louisville picked, labelled as regional. |
| Partner has no city heat → fanbase only | — | ➖ | Added after Sabrina Carpenter's first real run stopped at the city step (partner "The Way Home"). After tuning, her partner is "Anne with an E" and the run completes (New York City), so the case did not recur. Covered by the agent's code path; not reproducible on demand. |
| No partner above the threshold → widen | — | ➖ | No real fanbase tried (11 so far) left the first four categories empty after tuning. Covered by `tests/agent/loop.test.ts` with real-shaped data. |
| No tagged venues → nearest city | Call Her Daddy (matrix run 1) | ✅ | "No tagged venues in Lincoln, so I used Omaha, 79 km away." Probing Laredo, Lubbock, Fort Wayne and Bakersfield directly found tagged rooms in each; it fired naturally in the matrix. (After city tuning, Call Her Daddy now goes to Boston.) |

Bug found while doing this: `metroCities` merged cities across borders (Laredo into Nuevo Laredo,
San Diego into Tijuana, El Paso into Ciudad Juárez), removing them from the US list. Fixed; merges
now stay within one country.

Real runs so far (scripted planner):

| Fanbase | Result | Qloo calls | Time |
|---|---|---|---|
| John Mulaney | Mythic Quest (TV) · Seattle · The Rendezvous | 11 | 10.5 s |
| Sabrina Carpenter | Anne with an E (TV) · New York City · Pier 36 NYC | 11 | 11.5 s |
| Mercury (band) | Time Traveling Bong (TV) · Louisville (regional) · Headliners Music Hall | 10 | 11.0 s |
| Arsenal (before tuning) | complete, 0 sponsors | 11 | 18.7 s |
| Call Her Daddy (before tuning) | complete, stadium venue | 11 | 15.9 s |

Monthly quota after step 5: 49,778 of 50,000.

## Step 7 matrix (step 6, 25 Oct 2026)

Local app in real mode (`scripts/matrix.mts`, `scripts/matrix-ui.mts`), scripted planner (no
Anthropic key yet). Second pass, after the fixes below. Calls are for that run (repeats hit the
server's cache).

| Input type | Input | Result | Pass |
|---|---|---|---|
| Famous comedian | John Mulaney | Tour stop · Mythic Quest (TV) · Seattle (Qloo #1 / population #18) · The Rendezvous · sponsors Reddit, Buzzfeed, Tinder | ✅ |
| Famous artist | Sabrina Carpenter | Tour stop · Anne with an E (TV, popularity 0.968, not a mega-star) · New York City · Pier 36 NYC · Gap, Kate Spade New York, Keds | ✅ |
| Film | Sinners | Screening tour · Outcast (TV) · Los Angeles · Dolby Theatre · Rivian, DJI, Faraday Future | ✅ |
| Podcast | Call Her Daddy | Live show · Hannah Ann Sluss (person) · Boston (#24 by population) · Leader Bank Pavilion · Lulus, Tobi, Revolve | ✅ |
| Premier League club | Arsenal | Resolves to Arsenal F.C. (brand) · Fan fest · All or Nothing: Arsenal (TV) · London (UK market) · Greenwood · Nike Training Club, Burberry, Zara | ✅ |
| US team | Golden State Warriors | Fan fest · Winning Time (TV) · Los Angeles · 1212 Santa Monica · Finish Line, Yahoo Sports, Uninterrupted | ✅ |
| Misspelling | Kevn Hart | Did you mean Kevin Hart / Beth Hart / Corey Hart; resumed → Atlanta · Laughing Skull Lounge | ✅ |
| Misspelling | Billie Elish | Did you mean Billie Eilish / Billie Holiday / Billie Faiers; resumed → Phoenix · Arizona Financial Theatre | ✅ |
| Ambiguous name | Selena | Picker: Selena (film) / Selena (person) with Qloo descriptions; resumed → screening tour, Columbus (regional) | ✅ |
| Nonsense | asdfgh | "We couldn't find a fanbase called “asdfgh”" with examples | ✅ |
| Niche act | Black Country, New Road | UK market (from "An English … band") · Joe Pera Talks with You · London · The Shacklewell Arms · Vice, Stones Throw Records, Urbanears | ✅ |
| Non-English | أم كلثوم (Arabic) | Picker (artist / Umm Kulthum, person); resumed → New York City, regional | ✅ |
| Non-English | अरिजीत सिंह (Hindi) | Resolves to Arijit Singh · India market · Delhi · Sangeet Natak Akademi · Rolex, Bose, Sennheiser | ✅ |
| Rate limit | 6 fresh runs | Runs 1–5 allowed; 6th: "You've used your 5 live runs this hour. Try a cached example…" | ✅ |
| Swap partner / city | Use this partner, Use this city | Only steps 3–7 (partner) or 4–7 (city) rerun; steps before stay done | ✅ |
| LLM-only toggle | John Mulaney | HTTP 503 "not configured": needs a model key | ⏸ blocked (passed in the Gemini pass below) |
| Mobile | 380 px, Arsenal | No horizontal scroll; log collapses into the progress bar | ✅ |
| Brief export | Copy as text, print, Copy link | Text has no numbers next to capacity/price/date; print shows only the brief; link opens in a private window | ✅ |

### Failures in the first pass, and fixes

| Failure | Cause | Fix |
|---|---|---|
| Mercury (video game) stopped at partners, message "did not answer in time", agent retried until the turn cap | Qloo rejects video games as signals (HTTP 400); generic error text; scripted planner retried failed steps | Video games removed from fanbase search; distinct messages for 400 / timeout / other; failed steps are not retried |
| Hindi name found nothing | Name folding stripped Devanagari vowel signs; matching ignored Qloo's other names | Strip Latin accents only; non-Latin queries also match Qloo's `akas` |
| Warriors' sponsors were the Lakers, Clippers and Raiders | Teams are Qloo "Entertainment Brand" | Entertainment brands are not sponsors |
| Small-city picks (Lincoln for Call Her Daddy, Oxnard for Sinners, Bakersfield for Kevin Hart) | City heat used affinity only | City heat = affinity × cell popularity (docs/tuning.md) |

Known oddity, not fixed: "Selena" (the film) gets a Japanese politician as a person partner;
Qloo's person category includes politicians and the engine has no basis to exclude them by name.

Calls: first pass ~180, second pass ~70 (cache). Monthly quota after step 6: 49,538.

## Matrix with Gemini (26 Oct 2026)

Same API rows (`scripts/matrix.mts`) against a local production build, planner Gemini
(`gemini-3.6-flash`, falling back to `gemini-3.5-flash-lite`). Every pick, city, venue and sponsor
matched the scripted pass above, as expected: they come from the engine. The brief and emails
were written by the model (`templated: false`) and passed through the same sanitiser.

| Row | Result | Time | Pass |
|---|---|---|---|
| John Mulaney | Mythic Quest · Seattle · The Rendezvous (Qloo responses cached) | 17.8 s | ✅ |
| Sabrina Carpenter | Anne with an E · New York City · Pier 36 NYC | 131 s | ✅ |
| Sinners | Outcast · Los Angeles · Dolby Theatre | 183 s | ✅ |
| Call Her Daddy | Hannah Ann Sluss · Boston · Leader Bank Pavilion | 151 s | ✅ |
| Arsenal | All or Nothing: Arsenal · London · Greenwood | 165 s | ✅ |
| Golden State Warriors | Winning Time · Los Angeles · 1212 Santa Monica | 138 s | ✅ |
| Kevn Hart, Billie Elish | Did-you-mean, then resumed → Atlanta, Phoenix | 38 s, 68 s | ✅ |
| Selena, Mercury, أم كلثوم | Picker, then resumed → Columbus, St. Louis, New York City (regional) | 21–24 s | ✅ |
| asdfgh | "We couldn't find a fanbase called …" | 18 s | ✅ |
| Black Country, New Road | Joe Pera Talks with You · London · The Shacklewell Arms | 95 s | ✅ |
| अरिजीत सिंह | Coke Studio Pakistan · Delhi · Sangeet Natak Akademi | 106 s | ✅ |
| Rate limit | 6th run: "You've used your 5 live runs this hour…" | — | ✅ |
| LLM-only toggle | HTTP 200: "Curb Your Enthusiasm" in Chicago, no sources | — | ✅ |

**Problem found: the free tier is too small and too slow for judging.** Google's 429 for
`gemini-3.6-flash` names the quota `GenerateRequestsPerDayPerProjectPerModel-FreeTier` with a value
of 20 requests a day, about three runs. After it ran out, runs moved to `gemini-3.5-flash-lite`,
which answered in 10–16 s per call (10 s for "Say ok."), so a run took about 100 s.
`gemini-3.8-flash` returned 503 all day. A run uses about 9,000 tokens (207,078 for this matrix
and the smoke tests). Qloo quota after this pass: 49,304.

## Roadmap flows on live Qloo (roadmap/foundation, 28 Oct 2026)

A local production build in live mode (`TAKEOVER_MOCK` unset, in-memory database, sign-in through
the local outbox, scripted planner so only Qloo is exercised), driven through the UI by a
Playwright script. Calls per flow are the drop in Qloo's `x-month-ratelimit-remaining` as the
server saw it (`/api/health`), so cached answers (Upstash) count as 0. Quota read with
`scripts/quota.mts`: **49,061 before, 48,989 after: 72 calls in all**, both passes and probes included.

| Flow | Result | Qloo calls | Pass |
|---|---|---|---|
| Plan (agent run), saved to the workspace | Hozier, 7 / 7 steps, saved privately to the workspace | 12 | ✅ |
| Pipeline | Plan's two drafts added; one opened and marked sent; nothing emailed | 2 (the plan page's audience panel) | ✅ |
| Outcomes | 820 of 1,000 logged: 82% sell-through; "too few events to judge" | 0 | ✅ |
| Roster | 4 acts added by search; refresh estimated 23, used 20 ("never more"); 12 matrix scores link to evidence | 21 | ✅ |
| Your data | CSV of 5 cities uploaded, attached to Phoebe Bridgers: 5 ranked from the file, 10 untested cities listed by Qloo signal | 3 | ✅ |
| Market watch | Ali Wong (fanbase) and Chicago (city): first snapshots, no alerts | 4 | ✅ |
| Sponsorship, brand view | Liquid Death: 7 matches (top: The Human Upgrade with Dave Asprey), the saved plan shown under Your events | 13, then 2 (cache) | ✅ |
| Sponsorship, rights view | Golden State Warriors: 1 brand after the filters (Foot Locker), shortlisted and sent to the pipeline | 4 | ✅ |
| Sponsorship, one roster act | 11 brands for the first act, no search call | 6 | ✅ |
| Tour optimizer, US and Canada | Victoria → Portland → Denver → Toronto → Boston on one scale; per-country switch shown; saved to the workspace | 2 | ✅ |
| Tour optimizer, US West | Denver → Los Angeles → San Francisco → Portland → Seattle | 0 (cache) | ✅ |

First pass problems, all in the test set-up, not the app: the build had been made by the e2e run
with `TAKEOVER_MOCK=1`, so the layout's "Sample data" banner was baked in although the data was
live (health reported `mock: false`); fixed by rebuilding without it. "Phoebe Bridgers" replayed
the stored live run from 26 Oct (a cached example saves to My plans, not the workspace), so the
second pass planned Hozier. The CSV was set before the upload page had hydrated; the second pass
clicks through to it as a user would.

Observations to follow up:
- Upstash reads timed out at the 4 s limit 21 times during bursts (roster refresh, sponsorship),
  while `/api/health` pinged Redis in about 30 ms. The cache falls back to memory, so nothing
  failed, but bursts lose the shared cache. Worth checking the Upstash plan's request limits
  before judging.
- The Warriors' rights view kept only one brand once teams, leagues and non-brands were removed;
  the same call on 25 Oct gave three sponsors in the plan flow. Qloo's brand list for a team is
  thin after filtering.
