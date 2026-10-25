# Decisions log

Judgement calls made while wiring Takeover to the real Qloo API, newest last. Each entry: what,
why, and what else was considered. Qloo calls are counted from `x-month-ratelimit-remaining`.

## 2026-10-25 · Step 1: probe

**D1. Quota is not a stop condition; size the daily ceiling to it.**
Qloo reports 50,000 calls a month and 10 a second. An uncached run uses about 12–15 calls and
repeats are cached for 7 days, so with roughly 22 days to the end of judging the budget holds if
live runs are capped. The daily run ceiling will be set from the remaining quota (see step 3).
*Considered:* stopping to ask; not needed because the ceiling is ours to set.

**D2. One header check outside the client.**
The first call (to read rate-limit headers) was made with plain `fetch`, not through
`lib/qloo/client.ts`, before the client recorded quota headers. Every later call goes through the
client. *Considered:* none; noted because CLAUDE.md says every call goes through the client.

**D3. Trim env values in the client.**
`QLOO_BASE_URL` in `.env.local` has a space after `=`. Node and Next trim it, but a shell or another
loader might not, so the client trims both values. *Considered:* editing `.env.local`; left it to
the owner since it holds the key.

**D4. Probe inputs.** Comedian John Mulaney, chart artist Sabrina Carpenter, recent film Sinners,
podcast Call Her Daddy, Premier League club Arsenal, misspelling "Billie Elish", nonsense
"asdfgh", niche act Black Country, New Road. City for places: London (first probe), Chicago
(second, after tags were fixed).

**D5. A second and third probe were needed.** The first showed heatmaps need a location, guessed
tag ids returned nothing, and "Arsenal" did not reach the club. `scripts/probe-extra.ts` checked
locality insights (rejected), country-filtered heatmaps (work), typed search, clubs, real tag ids
and places. Calls: header check 1, probe 91 (incl. failures), extra 18 + 12. Quota after step 1:
49,879.

**D6. Raw Qloo responses stay local; a trimmed set is committed.**
The raw probe output is 34 MB (heatmaps 3–4 MB each) and is Qloo's data in a repo that will be
public; the playbook also says not to commit cached Qloo dumps. Raw files stay in `tests/fixtures/`
but are gitignored; `scripts/trim-fixtures.ts` writes `tests/fixtures/qloo/` with only the fields
we map and a subsample of heatmap cells, for tests. *Considered:* committing everything (size,
licensing); committing nothing (tests would need the API).

**D7. Cities come from heatmaps inside a market, not from locality insights.**
`filter.type=urn:entity:locality` rejected a person signal or timed out, and heatmaps require a
location. So city ranking runs inside one country (the "market"): the fanbase's home country from
Qloo properties when available, the agent's choice when it passes `country`, else the United
States. The product promise holds: the city where both audiences are strongest, within a market.
*Considered:* several countries per run (2 heatmap calls each, 2–7 s each, budget and time);
stopping to ask (city-level data exists, so the promise is unchanged).

## 2026-10-25 · Step 2: assumptions and the real source

**D8. Search only fanbase types.** Untyped search let places and localities win ("asdfgh" matched a
shop; "Arsenal" returned localities), and Qloo rejects those as signals. `types` now lists artist,
person, movie, tv_show, podcast, brand, book, videogame. *Considered:* filtering after an untyped
search (wastes the 10 result slots on places).

**D9. "Clearly the famous one" compares distance from popularity 1.** Popularity is a percentile
bunched near 1, so the old 0.8 ratio never separated anything. A same-name match in another
category is a rival only if it is no more than 5× further from 1 than the top match. Arsenal F.C.
(0.999) beats the video game (0.969); John Mulaney's person and artist entries (0.969 vs 0.966) are
handled by D10. *Considered:* always showing the picker for same names (too many pauses).

**D10. Merge a person's two entries using Qloo's description.** Famous people appear as `person`
and `artist`. Keep the person when either description says comedian/comedy/comic/stand-up (comedy
rooms and comedy partners), else the artist (music), carrying over the person's citizenship.
*Considered:* always the higher-popularity entry (picks the person for singers, giving comedy
venues to musicians).

**D11. Home market from Qloo properties, else the United States.** Order: person citizenship,
release country, "based in <City>" in the description, a nationality word in the description.
Default US when none (podcasts have no such property): it is the largest market in Qloo's data.
The agent can pass another country. *Considered:* asking the user (no design for it yet).

**D12. Nonprofits and government programmes are not sponsors.** Real brand lists included ACLU,
Planned Parenthood and TSA PreCheck. Excluded by Qloo's own `brand_type`; media brands stay.

**D13. People who are not comedians get a live show in a theatre**, not comedy clubs.

**D14. Partner categories are fetched three at a time and both heatmaps in parallel.** Heatmaps
take 2–7 s each; serial calls risked the 60 s route limit. Three at a time stays under Qloo's 10
calls a second even with a few runs at once. The run budget now reserves a slot before each call so
parallel calls cannot overshoot.

**D15. Place queries are "City, Region"** ("Chicago, Illinois"); the country code was never tested
and the region separates same-named cities.

## 2026-10-25 · Step 3: real source by default

**D16. Daily ceiling of 120 live runs by default.** About 45,000 spare monthly calls over the ~22
days to 16 Nov is ~2,000 a day; an uncached run uses up to 15. Cached replays and cache hits do
not count. `TAKEOVER_DAILY_RUNS` overrides it. *Considered:* 300 (the old default; could exhaust
the quota in about 11 days of heavy use).

**D17. Without Qloo credentials (and not in mock mode) `/api/plan` returns a 503 configuration
error**, like the missing planner key, instead of starting a run that fails at step 1.
`/api/health` also reports the monthly quota Qloo last returned.

## 2026-10-25 · Step 4: tuning (details and before/after in docs/tuning.md)

**D18. Changed the partner formula's inputs, not just its numbers.** The playbook's
`affinity × (1 − popularity)^0.5, drop p > 0.97` was meant to be tuned on fixtures; on real data it
always picked TV shows or popularity-0 junk, because both affinity and popularity sit at different
levels per category. Kept the shape (affinity times a mainstream discount) and changed: affinity is
relative to its category; popularity band 0.5–0.999; exponent 0.15. *Considered:* tuning the cut
and exponent only (no setting removed the TV-show bias); ranking within each category and
round-robin (loses the cross-category comparison).

**D19. The Prompt C test "drops pop 0.99" now uses 0.9995.** 0.99 is near the 75th percentile of
real partners; the guard's purpose (no mega-stars) is tested at the tuned ceiling.

**D20. Sponsors keep big brands.** Ceiling 0.9995 instead of 0.999: brands are naturally popular
and real sponsors are big names; only the very top is excluded.

**D21. Venue preference and wrong-size rooms.** A podcast live show landed in a stadium; formats
other than fan fest now weight stadiums and arenas down, and earlier-listed venue tags are
preferred.

**D22. City labels show the region** ("Portland, Oregon") because GeoNames has several cities of
the same name.

## 2026-10-25 · Step 5: fallbacks

**D23. New fallback: rank cities by the fanbase alone when the partner has no city heat**, labelled
"fanbase only", instead of stopping the run (CLAUDE.md: every step continues with the best result).

**D24. Three fallbacks are recorded as not reproducible on real data** (fanbase-only cities, widen
partners, nearest city for venues) rather than forced with invented inputs; evidence in
docs/test-results.md. They stay covered by unit tests.

**D25. Metro merging stays within a country** (bug: Laredo, San Diego and El Paso vanished into
larger Mexican neighbours).

## 2026-10-25 · Step 6: test matrix

**D26. Video games cannot be a fanbase.** Qloo returns 400 for video-game signals. They stay as
partner candidates. "Mercury" now offers the band and a film instead of a game.

**D27. Error messages say what happened**: unusable entity (400), timeout, or other error; a failed
step is not retried by the scripted planner.

**D28. Names in other scripts match Qloo's `akas`; Latin names do not**, because Qloo's aliases
include short forms that over-matched ("Mercury" → Phoenix Mercury).

**D29. Teams and leagues are not sponsors** (`brand_type` "Entertainment Brand").

**D30. City heat = affinity × cell popularity.** Affinity alone picked small cities a promoter
would question; popularity alone tracks population. The product still answers "where are both
audiences strongest" (docs/tuning.md).

**D31. Left as is: politicians can appear as person partners** ("Selena" film). Excluding people
by description words would be guesswork; noted in docs/test-results.md.

## 2026-10-25 · Step 7: examples and warm cache

**D32. Landing examples: John Mulaney, Phoebe Bridgers, Sinners, Arsenal.** Chosen on real runs for
the most specific results: Mulaney → Mythic Quest, Seattle, The Rendezvous; Phoebe Bridgers →
PEN15 and Maggie Rogers, Seattle, The Vera Project, Urban Outfitters/Dr. Martens/Free People;
Sinners → Los Angeles, Dolby Theatre; Arsenal → All or Nothing: Arsenal, London, Nike Training
Club/Burberry/Zara. *Considered:* Everything Everywhere All at Once (regional fallback to Oxnard),
Oppenheimer (obscure person partners), Golden State Warriors (a Lakers series steered it to Los
Angeles), Sabrina Carpenter (New York is also #1 by population, so the Qloo-vs-population story is
weak), Chappell Roan (venue "Hardcore Stadium").

**D33. Partners exclude the fanbase's own twin records** (Phoebe Bridgers was offered "Phoebe
Bridgers", her person record).

**D34. The warm cache refuses to run without Upstash (nothing would persist) and, by default,
without an Anthropic key** (preloaded briefs should be written by Claude, as production runs are).
Qloo responses it fetches are cached with no expiry; recordings and plans too.

## 2026-10-25 · Gemini as the planning model

**D35. Default model: `gemini-3.8-flash`.** Google's models page (last updated 22 Oct 2026) lists it
as the newest stable Flash and says new projects should use 3.5 Flash-Lite or 3.8 Flash. Flash
rather than Flash-Lite because the agent chains up to eight function-calling turns and writes the
brief's prose. *Considered:* `gemini-3.6-flash` (previous stable generation), `gemini-3-flash-preview`
(preview models can change or be withdrawn during judging), 3.5 Flash-Lite (cheaper, weaker at
multi-turn tool use). Override with `GEMINI_MODEL`.

**D36. `LLM_PROVIDER` defaults to `gemini` when unset** (it was missing from `.env.local`). A value
other than `gemini` or `anthropic` is a configuration error everywhere rather than a silent
fallback. Only the selected provider's key counts: with Gemini selected, an Anthropic key does not
satisfy the production guard. *Considered:* picking whichever key is present (hides a typo in
production).

**D37. Calls use `generateContent` with function declarations, not the Interactions API.** Google's
function-calling page now shows only the Interactions API, but the SDK's `generateContent` supports
function calling and fits the existing loop: the provider keeps the transcript and sends each model
turn back unchanged, which Gemini requires for thought signatures. Tool schemas go in
`parametersJsonSchema`, without `additionalProperties`; tools without inputs get no schema.
Function results go back as `functionResponse` with `output` (or `error` for a rejected call).
Thinking is `LOW`. *Considered:* the Interactions API (server-held state; a second loop to maintain
for one provider).

**D38. Spending limits.** Each call is capped at 8,192 output tokens for the planner (thinking
included) and 2,048 for the LLM-only answer. The daily budget (`LLM_DAILY_TOKEN_BUDGET`, default
2,000,000) counts input (prompt + tool-use prompt) and output (candidates + thinking) tokens from
the usage metadata, in Redis per UTC day, falling back to memory. When it is spent, new live runs
and LLM-only answers are refused with a friendly message that points to the cached examples; it is
checked before the per-visitor limit so a refused run costs the visitor nothing. A run that crosses
the line mid-way makes no further model calls and is finished by code, labelled, rather than
discarded after its Qloo calls were spent. *Considered:* stopping the run outright (wastes the Qloo
calls already made); estimating tokens before each call (inexact; the metadata is exact).
