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
| No tagged venues → nearest city | Laredo, Lubbock, Fort Wayne, Bakersfield, Hialeah | ➖ | Qloo returned tagged comedy or theatre rooms for every city that meets the tour minimum (250k). The only empty result, Hialeah, folds into Miami. Covered by unit tests. |

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
