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

**D39. Default model `gemini-3.6-flash` for now; per-call timeout and fallback.** On 26 Oct 2026
`gemini-3.8-flash` answered every call with 503 ("high demand") or 504 across about ten attempts,
on a free-tier key; `gemini-3.6-flash` and `gemini-3.5-flash-lite` answered. A real run starting
on 3.8 took 68.6 s (timeouts before falling back); on 3.6 it took 25.1 s. So the default is 3.6
(also stable, the previous generation), with 3.5 Flash-Lite as the fallback, and
`GEMINI_MODEL=gemini-3.8-flash` switches back with no code change. Each call has a 30 s timeout;
a 429/5xx is retried once after 1 s, then the next model is tried; a timeout goes straight to the
next model. The model is only switched before a run's first answer, since thought signatures
belong to the model that wrote them; a later failure ends the model's part and code finishes the
run, labelled. The plan route's `maxDuration` is raised from 60 to 300 s (Vercel's limit with
Fluid compute). The plan records which model planned it. *Considered:* keeping 3.8 as the default
(judges would wait 30 s or more per run while it is overloaded); a circuit breaker that skips 3.8
for a while after a failure (state per serverless instance; more code for a temporary problem).

**D40. Default planner: code runs the steps, the model writes the prose in one call.** The free
Gemini tier allows 20 requests a day per model (Google's 429 names
`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, value 20) and its Flash-Lite took 10–16 s a
call, so the six-call agent gave about three fast runs a day and 100 s runs after that. The steps
always run in the same order and every decision in them (match, widen, region, nearest city) was
already code, so the scripted sequence runs them, and one call with only `write_brief` and
`draft_outreach` writes the brief and both emails from names, kinds and Qloo's descriptions (no
scores). A real run went from 103 s to 17–19 s. The full agent stays available with
`TAKEOVER_PLANNER=agent`. Free-tier quotas are per model, so the fallback chain is now
`gemini-3-flash-preview` (1.7 s), `gemini-3.1-flash-lite` (3.7 s), `gemini-3.5-flash-lite`
(15.6 s); `gemini-2.5-*` return 404. A 429 moves to the next model without a retry. This changes
what the README claims: the model writes the plan's words, code makes every pick. *Considered:*
paying for Gemini (the user chose free); other free providers (new code, smaller limits, weaker
tool calling); several Google projects to multiply quota (against the spirit of the free tier).

**D41. Writing rules added after reading real Gemini drafts:** sponsors are suggestions, never "on
board"; emails are written as the promoter and do not name Takeover. Gemini's first drafts said
"We have Urban Outfitters, Dr. Martens, Free People onboard" and "on behalf of Takeover". Sponsor
names are now joined as "A, B and C".

**D42. Mock mode never calls the model.** The Playwright suite runs in mock mode but loads
`.env.local`, so every sample run asked Gemini to write prose for sample data and used up a day of
free quota on two models. Mock mode now always uses the scripted planner and the labelled sample
LLM-only answer. *Considered:* keeping model prose in mock mode (it spends real quota on
sample data and makes tests depend on Google's availability).

## 2026-10-27 · From one tool to a site

**D43. Four ways in, one place to keep work, no accounts.** Navigation and a footer on every page;
the landing page gains "Who it's for", real plan cards and the with/without Qloo comparison from
stored runs; `/explore` (every preloaded plan), `/plans` (finished plans in localStorage: no
sign-up, nothing about the visitor on our server), `/compare`, `/method` (numbers read from the
engine config). *Considered:* accounts and saved plans on the server (need an auth provider and
a privacy story; out of scope before judging).

**D44. Venue booker uses Qloo insights with a location as the only signal.** Probed on 27 Oct: for
a city, Qloo returns artists, podcasts and people that over-index there (Seattle: Macklemore,
Tacocat; Nashville: Kacey Musgraves; Atlanta: T.I.). Affinity is ~1.000 for most results, so
Qloo's order is kept after the partner popularity band. "People" mixes in politicians and
athletes, so comedians use Qloo's `urn:tag:occupation:person:stand_up_comedian` tag (Atlanta:
Kountry Wayne, DC Young Fly, Druski); `urn:tag:genre:media:comedy` returned nothing.

**D45. Brand match and City explorer reuse the takeover engine.** Brand match: `scorePartners`
per category with `minCategories: 1`, and the brand's heatmap in its home market scored by
`scoreCities` with the brand on both sides (cities of 300,000+). City explorer: four heatmaps (the
fanbase's home market, then US, GB, CA, AU), cities of 150,000+; heat is relative within a
country, which the page says. Every result links to a full takeover plan.

**D46. Heatmap calls get a 20 s timeout and Redis reads 4 s.** Cold heatmaps for big fanbases
(Taylor Swift, US) took longer than 8 s, and reading a cached 400 KB heatmap from Upstash took
longer than 1.5 s from a home connection, which then fell back to the slow live call.

**D47. Theme switch and the design's "Gen Z" style, saved per browser.** Dark stays the default
(a light system preference still wins until the visitor picks). Gen Z mode is the design's
`mode: genz` (Landing.dc.html): 2px ink borders and a hard 4px ink shadow on surfaces and
controls, existing tokens only; the brief's paper page and print are unchanged. Both are applied
by the first-paint script, so there is no flash. `<body>` gets `suppressHydrationWarning`, like
`<html>`: a browser extension was adding an attribute to it before React loaded.

**D48. Sample-data mode never uses Redis for rate limits.** The Playwright suite runs in mock
mode with `.env.local`, so its runs were counted against the shared daily ceiling in Upstash and
used up the day's 120 live runs. Mock-mode limiters now live in memory.

**D49. Six more features (27 Oct), all on Qloo data already probed.**
- *Fan overlap* (`/overlap`): Qloo affinity of each side among the other's fans via
  `filter.results.entities` (probed: PEN15 among Phoebe Bridgers fans 0.98; Taylor Swift →
  Formula One 0.74; one direction can come back empty), two heatmaps in A's home market scored
  together, and both audiences' demographics. Levels: strong ≥ 0.92 (the median affinity of the top
  20 partner candidates in tuning), clear ≥ 0.85, else some. Up to 8 calls.
- *Audience profile*: Qloo `urn:demographics` skews (−1..1) per age band and gender, shown as
  diverging bars on plans, Fan overlap and Brand match; "balanced" below ±0.1. One call per entity:
  a combined signal would blend the two audiences.
- *Share images*: `/plan/<runId>` gets an Open Graph image and title from the stored plan; the site
  a default card.
- *Recent plans and Surprise me*: live plans (never mock, never preloaded) are pushed to a capped
  Redis list of plan summaries only; Surprise me opens a random preloaded plan (instant, free).
- *Tour planner* (`/tour`): the takeover's tour routing on the fanbase's own heatmap; 4, 6 or 8 stops.
- *Search suggestions*: Qloo `/search` after 300 ms and 3+ characters, cached, 300 an hour per
  visitor; Enter keeps what was typed unless a suggestion was chosen with the arrow keys (a slow
  answer for earlier text was replacing the typed name).

**D50. Gen Z is a third theme, as the updated handoff specifies** (`data-theme="genz"`: warm paper
palette, `--bw`/`--card-bw`/`--shadow` tokens). Hairline elements use `border-th` (2px ink in Gen
Z), panels, cards, step cards, the primary button and segmented controls `border-card border-ink`,
surfaces and the input bar `shadow-card`, the active tab `shadow-tab`; banners, dashed pills and
table rules stay 1px. This replaces D47's Gen Z overlay on dark/light. The theme switch is one
three-way control in the header's top row; a saved overlay setting migrates to the Gen Z theme.

## 2026-10-27 · New ideas on Qloo data

**D51. Takeover Daily** (`/daily`): one preloaded plan a day (seeded by the UTC date; the first in
the day's order that fills all three rounds), so it costs no Qloo or model calls. Rounds: the
partner (the plan's shortlist plus another plan's partner), the city (Qloo's top cities, the
biggest by population, then the plan's map list), the sponsor (the plan's top brand plus other
plans' sponsors). Answers stay on the server and are checked per guess; reveals are the plan's own
numbers. Streak and stats live in the browser. Puzzle #1 is 27 Oct 2026.

**D52. Lineup builder** (`/lineup`): support acts (artists) and hosts (people) scored by the
partner engine on the headliner's signal, its strongest city in its home market and a venue
there; 5 Qloo calls. "Crowd fit" is the mean Qloo affinity of the picks among the headliner's fans,
×100, and the page says so. Suggestions are stored for a day and a saved poster may only use them,
so a poster cannot carry names Qloo did not return (only the event name is free text, 40
characters). Posters are rendered by `next/og` with Anton (SIL OFL, bundled in `lib/fonts/`), saved
for 30 days, shareable with a preview card. Support acts are not offered again as hosts.

**D53. Meet the fan** (`/fan/<name>`): demographics plus the top three per category (artist, TV,
film, podcast, brand, book) by the partner score; the intro sentence is built by code from that
data, no model call. Cached a day per name (`"use cache"`), which also serves its share image.

**D54. City pages** (`/city/<slug>`): the Venue booker lists, now including brands (location-only
Qloo insights); cached a day so crawlers cost nothing after the first visit.

**D55. Trending** counts real use per UTC week in Redis sorted sets: fanbases and cities of
completed live plans, and Fan overlap pairs. Names only; never in mock mode. Shown on the landing
page as counts of use, never as Qloo scores.

**D56. Team voting** on shared plans: one vote per visitor (hashed IP) per question (partner, city),
changeable, stored as a hash per plan for 30 days; only the plan's own options are accepted.
Upstash returns numeric strings as numbers, so values are normalised to strings.

**D57. Navigation regrouped** to Plan · Daily · Tools · Explore · My plans · How it works; `/tools`
lists every tool and the footer links them all. The nav is in a Suspense boundary because dynamic
routes cannot read the path while prerendering.

**D58. Landing page cut to one of each thing.** The page repeated itself: nine identical tool
cards (the same list as `/tools` and the footer), two plan grids, a hero paragraph and step cards
that said the same thing, and an FAQ entry about the tools. Now: a shorter hero with a rotating
line of real preloaded results ("John Mulaney × Mythic Quest → Seattle, only #18 by population"),
the four steps as one numbered strip, the with/without Qloo comparison moved up, a "Play with Qloo"
row (round 1 of today's Daily playable in place, sharing its progress with `/daily`, beside Fan
overlap), the other tools as one row of chips, one plan grid with Featured / Just planned tabs,
trending, and four FAQs. Considered: a scrolling marquee of plan cards (new motion the design
does not define; the ticker reuses the design's 250 ms dim) and an inline lineup builder (too
heavy for a landing page). Every value shown still comes from a stored run or a Qloo-backed API.

## 2026-10-28 · Team product: rules and architecture (proposal)

**D59. Roadmap rules** in `docs/roadmap-rules.md`, referenced from CLAUDE.md: user data is
labelled "Your data" and never blended into a Qloo number; every customer table has
`workspace_id` and every query is scoped; jobs respect a per-workspace monthly Qloo allowance and
a global daily cap in the Qloo client; nothing is sent to a third party without a click on that
exact draft. Added: jobs keep a reserve of the daily cap for interactive users
(`QLOO_JOB_RESERVE`), so a weekly job cannot starve the live site. Considered: a separate job cap
(two numbers to tune instead of one).

**D60. Neon for Postgres, QStash for jobs** (the request left both open). Neon: Vercel
Marketplace, serverless HTTP driver for Drizzle, preview branches. Considered Supabase (its auth
and storage duplicate Auth.js and Blob). QStash: already on Upstash, signed calls, retries, one
message per workspace. Considered Vercel Cron (once a day on Hobby, no retries or fan-out).

**D61. The unscoped-query test helper is written now** (`tests/support/scoped-queries.ts`), before
Drizzle is installed: it reads the SQL Drizzle emits for Postgres, so it needs no database. It
proves a `workspace_id` condition is present, not that it holds the right workspace; the scoped
repository supplies the value. Considered: Postgres row-level security as the only guard (the
HTTP driver has no session to carry the workspace id); kept as a later second layer.

## 2026-10-28 · Team foundation: database, auth, workspaces, comments (branch roadmap/foundation)

**D62. Roadmap work lives on `roadmap/foundation`; `main` stays the judged hackathon build** (user
instruction, until 16 Nov). The roadmap-docs commit made earlier on main was moved to the branch
before anything was pushed.

**D63. Local stand-ins until Neon and Resend keys exist** (user chose this). PGlite runs the same
Drizzle migrations in-process for dev, unit tests and e2e; an in-memory outbox at `/dev/outbox`
replaces email when `RESEND_API_KEY` is unset. Both are refused on Vercel: no `DATABASE_URL`
throws at startup, and with no Resend key the outbox does not exist and sending fails closed.
`AUTH_SECRET` was generated locally into `.env.local`. Considered: Docker Postgres (not installed),
skipping auth tests until keys arrive (would leave the core flow untested).

**D64. Production driver: `postgres` on Neon's pooled URL, not the Neon HTTP driver.** The HTTP
driver has no transactions, and accepting an invitation or creating a workspace writes several
rows that must land together.

**D65. Four cross-workspace lookups, named `unscoped*` and lint-fenced.** Choosing a request's
workspace, opening `/plan/<id>`, reading an invitation token and creating a personal workspace
cannot know the workspace in advance. They live in `lib/db/unscoped.ts`, which only `lib/workspace`
and `lib/auth.ts` may import; everything else goes through `forWorkspace()`. A test records every
query from a full workflow and fails on any unscoped one.

**D66. Workspace plans are private by default and never public by accident.** Signed-in runs by
members (not viewers) save to Postgres only: not the public Redis store, not "Just planned", not
trending, so a brand's unannounced campaign never shows on the landing page. `/plan/<id>`, its
title, its preview image, Compare and votes all go through one access check, and a refused plan
answers 404 (not 403) so its existence is not revealed. Signed-out plans keep working exactly as
before and stay public.

**D67. Imported browser plans get new ids.** A plan in My plans may already be shared; giving the
workspace copy the same id would make that public link private. The copy records `imported_from`,
so importing twice does nothing.

**D68. Roles:** viewer reads; member also plans, comments and resolves, and can share their own
plans; admin also invites, manages members below owner and can share any plan; owner also renames
and manages owners. The last owner can neither leave nor be demoted. Invitations must be accepted
by the invited email; links last 7 days, a new invite replaces a pending one, and only the
token's hash is stored.

**D69. @mentions use email handles** (the part before @, with the domain label appended on a
clash), offered as chips under the comment box. Considered: a typeahead (a new component the
design does not have) and display names (spaces and duplicates). Mentions create in-app
notifications only; the inbox marks them read when opened.

**D70. Comments are one level deep and resolved per thread.** A reply to a reply joins the same
thread; only a thread's first comment can be resolved. Comments are never shown on a public link.

**D71. No Auth.js "new user" page.** It would send a first-time invitee to the welcome page
instead of back to their invitation; sign-in returns to the page it came from, and `/signin`
alone lands on the workspace.

**D72. Signed-out requests never open the database.** Without an Auth.js session cookie the
session read returns at once, and `/plan/<id>` checks the public store before Postgres. This
keeps anonymous traffic (most of it) off the database; it also fixed a cold-start delay that made
a run hang in e2e.

**D73. Sign-in and invitation emails are rate-limited** at 10 per visitor per hour, so the forms
cannot be used to flood someone's inbox.

## Roster intelligence (28 Oct, branch roadmap/foundation)

**D74. The roster screens live in the workspace pages, not the design's sidebar App Shell.** The
new design (`Takeover design system (1).zip`, Roster and Empty rosters screens) draws them inside
a sidebar shell with Pipeline, Watchlists and other pages that do not exist yet. Building that
shell now would add empty pages; rosters get a "Rosters" tab next to Plans instead, with the
design's header, import panel, acts table, confidence cell and pairing cards. Considered: the full
shell first (larger, mostly placeholders).

**D75. "% shared fans" in the design is shown as a shared-audience score, 0–100.** Qloo affinity
says how strongly one fanbase over-indexes on an act; it is not a share of fans, so a percentage
would invent a number. The score is the mean of the two directions (B among A's fans and A among
B's), × 100, computed by `scoreRosterPairs`; both directions are shown as evidence. A pair with
one direction uses it alone at most medium confidence; with none it is listed as unscored, never
given a number. Considered: the higher direction (as the Fan overlap level does) — the mean keeps
the score symmetric while penalising a one-sided pair.

**D76. Pairings take one Qloo call per act and category.** `filter.results.entities` needs one
`filter.type`, so an act is asked about the other acts of each category separately. An
all-comedian roster is one call per act, as the brief asked; a mixed roster is two. The answers
are stored on the act with the set of acts they were asked about, so adding or removing an act
re-pairs every act at the next refresh, and nothing else is asked again within a week.

**D77. An act's row reuses the plan's engine functions** — `scoreCities` (split into `cityHeat` and
`scoreCityHeat`, with identical results, so a city's heat can be stored), `scorePartners` and
`rankBrands` — on 4 calls: partner candidates in the first two categories the agent tries, one
heatmap in the act's home market, one brand list. The row's confidence is the weakest of the
three (`actConfidence`), shown as a level with a three-step bar and no number; the design's
"91 / 100" city score is dropped because a single fanbase's top city is always 100 by
construction. The pair's best shared city is scored from the two stored heats with no extra call.

**D78. Profiles are cached per Qloo entity across workspaces** (`entity_profiles`, no
`workspace_id`): they are Qloo data about a public entity, not customer data, and one cache
saves every agency the same calls. Keyed live or sample, so sample data never stands in for a live
profile. They are reused for 7 days; "Refresh all" re-asks Qloo with a new `fresh` option on the
client that skips the cache read.

**D79. Workspace allowance and daily cap built now** (architecture step 2), because the brief's
budget block needs them. The default allowance is 500 uncached calls a month; there is no daily
cap unless set. Adding an act costs one search and does not score it: scoring waits for the
user to see the refresh estimate and click. The estimate is an upper bound (cache hits are free).
CSV imports check that one search per name fits before searching, and stop at a budget, marking
the rest unresolved with the reason.

**D80. Large refreshes are staggered through QStash, without a new package.** A refresh is split
into batches of at most 25 calls (one run's cap); one batch runs in the request, more go through
the queue 30 s apart. QStash publishing and its JWT signature check are a few lines on `fetch` and
`node:crypto`, so no `@upstash/qstash` dependency. Locally the queue is an in-process timer; a
Vercel deployment without QStash refuses large refreshes rather than running them in a request
that may be cut off.

**D81. "Plan this pairing" keeps the roster partner.** The run opens with the act as the fanbase
and the other act as the partner (`/run?q=&entity=&partner=&pc=`). The partner step asks Qloo for
the chosen partner's affinity and scores it like a candidate; if its category is the fanbase's own
(two comedians), that category's candidates are fetched only as its comparison group, so the
shortlist is unchanged and a lone candidate is not rated "high" against itself. If it would not
be shortlisted it is kept at low confidence and the plan says why.

**D82. CSV import columns follow the design** (act_name required, qloo_id, home_city). The file is
parsed in the browser, so the user sees the count, skips and search cost before anything is sent;
up to 100 rows. home_city is stored as the user's data and shown with the Your data label; it does
not change any score. Unresolved names come back for matching by hand with the resolver's choices.

**D83. `roster_acts` carries workspace_id** although the brief listed only roster_id, per rule 3,
and the act's resolver snapshot (description, tags, home country), which the format and market
rules need. A roster holds at most 40 acts (780 pairs, 40–80 calls a full refresh).

**D84. Exports.** The matrix CSV has one row per act with its picks and a shared-score column per
act (symmetric), "no data" or "not scored yet" where there is none, and a source column; cells
that start like a formula are quoted. Feature 10 (deck settings) does not exist yet, so the deck
is the plain house deck: the plan deck's renderer now takes any outline.

**D85. Roster "done when" checks (28 Oct).** A 10-act roster on a cold cache planned 59 calls in 3
batches and used 59; all 45 pairs were scored. The page now shows the act-by-act matrix (each cell
links to its pair), "estimated N, used M" after each refresh, and an Evidence section under every
pair and act: Qloo's values, how the score follows from them, and the exact requests (endpoint and
params, never the key). Requests are stored with the act (`roster_acts.affinities_calls`, migration
0002) and in its profile; profiles cached before this show "refresh to record them".

## Your data (28 Oct, branch roadmap/foundation)

**D86. Datasets replace `user_facts` for uploads.** A file of city rows with several metrics fits
two tables better than one fact per value: `datasets` (the file, its mapping and the attached
fanbase) and `dataset_rows` (raw city, matched metro, metric values), both with workspace_id and a
check constraint that `source = 'user'`. `user_facts` stays planned for single typed-in facts.

**D87. XLSX without a spreadsheet package.** An .xlsx is a zip of XML; `fflate` (already used to
build the city data, now a runtime dependency) unzips it and the first sheet is read with its
shared strings, inline strings, numbers and booleans. Considered: SheetJS (its npm release is old
and the current one is not on npm) and exceljs (large). The same reader runs in the browser for the
preview and on the server for what is stored.

**D88. `@vercel/blob` 2.8.1 with `access: "private"`.** The SDK supports private blobs, so files
have no public URL and are never served back; the app only stores and deletes them. 2.8.1 is 22
days old. The clean reinstall pulled `undici` 6.29.1 (13 days old) through it, so `undici` is
overridden to 6.29.0; `zod` is now 4.1.11 everywhere because `@vercel/cli-config` pins it exactly
(an older release within every other package's range). Considered: `npm install --before`, which
fails because `next` 16.4.3 is pinned and newer than the cutoff.

**D89. City names are matched to GeoNames metros by code, with a review list.** Accents, case,
"St"/"Saint", a trailing "City", "City, ST" and a few short forms (NYC, LA, DC) are handled;
boroughs fold into their metro (Brooklyn counts for New York City) as in plans. Several cities
left: the largest wins only when it is at least 10× the next (London, England over London,
Ontario); otherwise the name goes to "Check city names" with its options (Springfield; Saint
Louis, which also names a city in Senegal). Unmatched rows stay out of the ranking until a person
picks a city or skips them; a different spelling can be searched. Matching uses cities over
100,000 people, so a smaller town is reported as not found rather than guessed.

**D90. `combineCityScores` and the weight.** Your data = a city's summed metric ÷ the best city's
(the design's "scaled 0–100 against your best city"); Combined = (1 − w) × Qloo + w × yours,
w = 0.5 by default, in steps of 0.1. Every row keeps the Qloo part, your part (and the raw number)
and the weight. A city missing on one side uses the other side alone, as the design says; so at
w = 1 a city you never played can tie with your best city, which is the honest reading of "not in
your file" (unknown, not zero). The slider recombines in the browser by calling the same engine
function; the formula is on screen and in /method.

**D91. The ranking's Qloo signal.** On the data page, the attached fanbase's own heat in its home
market (the act profile used by rosters, cached a week per entity, 4 calls when missing). In a
plan, the plan's own city scores (fanbase with partner): plans now store a compact ranked list of
up to 100 cities (`city.ranked`, id and score) so cities outside the top five can be combined.
Neither changes the plan's chosen city: "Use this city" is the user's click, a normal replan.

**D92. User data never reaches the model or another workspace.** The agent and `lib/llm` never
read datasets (a test fails if they import `lib/data` or the database); the plan stores no user
data; a plan's three columns come from a members-only route at view time, so a public link shows
none. A test runs a full plan with a recording model in a workspace with data attached and checks
that no file name, value or label appears in any prompt. Another workspace gets the not-found page.

**D93. No "Use sample file" button.** The design has one, but sample sales figures would be
numbers invented by us inside the Your data channel. The empty state links to /method instead.

**D94. Deletion is one click, without a confirm dialog,** as asked: rows, dataset and file go
together, and the activity log records the deletion by name only.

**D95. Your data "done when" (28 Oct).** Every number in a city ranking can be traced from its row
("Where these numbers come from"): the Qloo signal as the city's heat over the hottest city's
(or, in a plan, √ of both audiences' heat), with the heatmap requests; Your data as the file's
rows that sum to it, over the best city's total (the engine now returns that scale); Combined as
its arithmetic with the weight. Plans now store each city's two heat values and the heatmap
requests (`city.ranked`, `city.calls`). Deleting a dataset also clears its file name and counts
from the activity log ("deleted data and its file" stays), so after one click it appears in no
view: the data pages, plans' city steps, or settings.

## Market watch (28 Oct, branch roadmap/foundation)

**D96. What a snapshot holds.** A fanbase: its top 10 cities by heat in its home market (city heat
scaled to the hottest, scoreCityHeat) and its top 10 crossover partners (scorePartners over the two
partner categories a plan tries first), 3 Qloo calls. A city: its top 10 per category for artist,
podcast, TV show and brand (rankLocal, the Venue booker's ranking), 4 calls. Each entry keeps its
Qloo entity id, rank and value; the requests are kept with the snapshot as evidence. A list Qloo
did not answer for is left out, so it is never compared with a real one.

**D97. `diffSnapshots` and its thresholds** (`ENGINE_CONFIG.watch`): top 10; a move of 3 places or
more; a value change of 0.05 or more (5 points on the 0–100 scale shown). One change per entry, the
rank move first when both happen; each carries both snapshots' rank and value. A list the previous
snapshot did not have is not compared. Entries that drop out of a list are not alerted (not asked
for, and usually the other side of a new entry).

**D98. No alert from a single snapshot.** Adding a watch takes the first snapshot at once (when the
allowance has room) and says "First snapshot taken; changes appear next week". Alerts are only
created by comparing two snapshots and store both ids. The next check is the next Monday at least
four days away, so two snapshots are never days apart.

**D99. The weekly job.** A QStash schedule (Mondays 07:00 UTC) calls a tick that finds workspaces
with something due through one new named lookup (`unscopedWatchWorkspacesDue`, added to the rules'
list) and queues one job per workspace, 30 s apart, acting as the workspace's first owner. Before
each item the job checks the workspace allowance, the daily cap and the job reserve; an item that
does not fit is skipped, its note says which limit and when it is next tried (the 1st of next month,
or tomorrow), and the job is recorded as "skipped_budget". Nothing retries before then. Locally,
with no scheduler, a request with the e2e token may run the tick as of a later date.

**D100. Alert wording is templated from the diff** (`lib/watch/wording.ts`): titles and bodies use
only the entity and item names and the two snapshots' ranks and values. The digest may ask the
model (through lib/llm) to rephrase a line; `safeRephrase` keeps the rephrasing only if it has
exactly the same numbers and names, and otherwise sends the template.

**D101. The digest is opt-in per person and workspace,** with an unsubscribe link that works
without signing in: a token signed with AUTH_SECRET for that person and workspace, so nothing
secret is stored (the table's hashed token was dropped before its migration shipped). Opening the
link changes nothing (mail scanners follow links); the button does. A one-click endpoint takes the
List-Unsubscribe POST. No email in a week with no changes. "Send me a test" goes only to the person
who clicked.

**D102. Departures from the design.** Each watch shows its real status ("1st snapshot", "N
changes", "No changes", or a skip note) instead of the design's "88 / 100 ▲3", which has no defined
meaning for a fanbase. "Edit recipients" is left out: one member must not subscribe another (rule
5); each turns the digest on for themselves and the preview lists who has. The "Thin data" alert
type is not built; a list that was empty and fills up shows as new entries.

**D103. Watches live in a "Watch" workspace tab**, like Rosters and Data (D74). A workspace can watch
up to 30 fanbases and cities (at most about 120 calls a week).

**D104. Alerts are dated by their snapshot**, not by the database clock, so a run as of a given
Monday (the job, or a test standing in for it) files its alerts in that week.

**D105. Market watch "done when" (28 Oct).** Alert creation is now `recordSnapshot`, used by the
weekly check and by tests: two seeded snapshots give exactly the expected alerts (a rank move, a
value fall, a new entry; three unchanged entries stay quiet), each with both snapshots' values and
ids. A local-only route (404 unless local with the e2e token) seeds a second snapshot from an item's
real one so the alerts can be checked on screen. A value change with no rank move says "still #N".

**D106. The digest in the three themes.** The site's theme lives in the browser, so each person
picks the email's look (Light, Dark, Gen Z; Light by default) in Market watch, with a preview that is
the email's own HTML. The email uses inline hex colours copied from each theme's tokens (a test
reads app/globals.css and fails on any other colour), table layout with bgcolor, no CSS variables,
classes or style blocks, and fonts every client has. Gen Z keeps its hard ink outline and offset
shadow (clients without box-shadow keep the outline). Text, links and the button are at least 4.5:1.

## Sponsorship (28 Oct, branch roadmap/foundation)

**D107. `scoreSponsorFit(a, b)`** (lib/engine/sponsor.ts): Qloo affinity in each direction measured
(the brand among the holder's fans; the holder among the brand's fans), fit = their mean × 100,
level and confidence from the overlap thresholds (one direction: at most medium). Evidence is a
list built from those values only, plus "Reach, impressions, fees and availability: to confirm".
Both directions missing: no fit, the match is not shown. Considered: rankBrands' niche score as
the fit; it is relative to the list, so it would not compare across searches.

**D108. The design's "2.1× versus the US average" and "crossed 0.70 this week" are not shown.** Qloo
gives a 0–1 affinity, not a multiplier against an average, and "this week" needs Market watch
history; both would be invented here. Evidence shows Qloo's affinity both ways instead.

**D109. Brand view extends Brand match** (`matchBrand` options): teams (brands with Qloo's "Sports
Organization" tag among the brand's fans), the audience skew (demographics) and the reverse
direction for the top six picks. The public Brand match tool keeps its six calls; the workspace
view uses up to 14.

**D110. Rights-holder view.** An act or team (resolver with picker), an event (a saved plan:
fanbase and partner as one signal, its cities from the plan) or a roster (up to 10 acts as one
signal). Brands come from `rankBrands`, whose non-sponsor rule now also drops any brand with the
"Sports Organization" tag: real teams such as Arsenal F.C. have no brand_type, so before this a
rival team could be pitched. The best five brands of an act or team get the reverse direction;
events and rosters are combined audiences, so one direction, labelled. Grouped by Qloo's first
genre:brand tag ("Other" when Qloo has none). Up to 9 calls.

**D111. Pitch deck** (lib/export/sponsor.ts): cover, why it fits (the evidence), the audience
(summariseAudience's reading), where the fans are (city heat) and a templated pitch, in the house
deck (branded deck settings do not exist yet). No model step: the template uses names and Qloo's
values only, so there is nothing for a model to add; a test checks every number in the deck is one
the engine produced.

**D112. Shortlist from the server's copy.** A run's matches are kept server-side for a day; saving
sends the run id and the match, never a score, so a shortlisted fit is always the engine's.
`sponsor_matches` stores the pitch input so a deck can be rebuilt without Qloo. Sending to the
outreach pipeline waits for Feature 7.

**D113. Sponsorship "done when" (28 Oct).** A brand (Liquid Death) and a team (Golden State Warriors,
a Qloo brand tagged "Sports Organization"; both added to the sample data) each give a ranked match
list in which every fit carries its Qloo values as evidence. Every pitch now records the Qloo request
behind each figure (forward and backward affinity, cities, audience), shown on the card as "Where
each figure comes from" and as a Sources slide. The deck builder is split from the download, so a
test builds the real .pptx, unzips it, checks every part is well-formed XML, and checks that every
number in the slides is one the engine produced or a digit of a recorded request; the e2e opens the
file the browser downloaded the same way.

## Outcomes (28 Oct, branch roadmap/foundation)

**D114. Fields follow the brief, not the design's sample form.** Attendance, tickets sold, sellable
capacity, gross (in the workspace's currency, as entered), sponsor renewed (yes, no or not known)
and notes, all optional, stored in `outcomes` with `source = 'user'` and shown with the Your data
label. The design's "partner promo-code sales" and "top sponsor by activation" are left for later:
they need a field per partner and per sponsor.

**D115. Predictions are frozen when a plan is saved.** `plan_predictions` is written in the same step
as the plan (and on import) from the plan as the engine produced it: the chosen city with its rank,
combined score and confidence; the chosen partner with its rank, score and confidence; the venue; the
sponsors. Outcomes compare against that row only; nothing recomputes it. A plan saved before this
existed has its predictions read from the plan as it was stored, dated when it was made, and frozen
when results are first logged.

**D116. No "Matched / Missed" verdicts from invented thresholds.** The design marks a prediction
"matched" at, for example, 85% sell-through; nobody set that bar. Results are compared with the
workspace's own median sell-through instead, and only once there are enough events
(`ENGINE_CONFIG.outcomes.minSample`, 5): below it every view says "too few events to judge" with the
count. "Above" is strict, so an event at the median is not counted as above it. Sell-through is
computed (sold ÷ capacity) only when both are entered and capacity is positive.

**D117. The report** groups logged events by the chosen city and by the chosen partner: events, how
many sold through above the median, and whether that group has enough events to judge on its own.
Exported as CSV (results labelled `_your_data`, predictions as frozen) and as the house deck
(branded deck settings do not exist yet).

**D118. Calibration hook, and how calibration could work later.** Each logged plan with a
sell-through stores pairs in `calibration_pairs`: the frozen predicted score (the chosen city's
combined score, the chosen partner's score), its confidence, and the sell-through. Nothing reads
them to change a score. Later, with enough pairs:
- Per workspace, a monotone fit (isotonic regression) of sell-through on predicted score would show
  whether higher scores sold better for that workspace, and where the curve is flat.
- The result would be shown beside a score ("for your events, scores like this sold through at
  about…"), labelled as combining Qloo with Your data (rule 2), never folded into the Qloo score.
- Confidence bands could be checked: do "high" picks sell through above the median more often than
  "medium"? If not, the confidence thresholds in config are wrong for that workspace.
- Engine thresholds would only change by a reviewed edit to config with the evidence attached,
  never automatically, and never across workspaces without their consent.
- Minimum before any of this: the same minSample per group, and a hold-out check that the fit
  predicts better than the workspace median alone.

**D119. Outcomes "done when" (28 Oct).** Three seeded plans with different frozen predictions (two
in Austin with different partners, one in Seattle), results logged on each (one without capacity):
the report counts 3 logged, a sample of 2 with sell-through, Austin with 2 events and not yet judged,
and Seattle out of the sample. The stored plans are then changed and the report does not move. A test
checks every number in the CSV and the deck is an entry, a frozen prediction or computed from them.
Plan labels on the Outcomes pages now come from the frozen predictions too, never the stored plan.

## Tour optimizer (28 Oct, branch roadmap/foundation)

**D120. `optimizeRoute(cityScores, constraints)`** (lib/engine/route.ts) maximises Σ stop score × 100 −
distanceWeight × total km ÷ 1,000 (`ENGINE_CONFIG.route.distanceWeight`, 5: a route 1,000 km longer
must gain 5 points). The weight and the breakdown are on screen. Hard constraints, never broken:
number of stops, longest leg, start first, end last, cities to include and skip, and 150 km between
stops (the plan tour's spacing, so one metro is not visited twice). A finished route is checked by an
independent `satisfies` function; if no route passes, none is shown and the message names the
constraint (both required and skipped; more required cities than stops; required cities too close;
no route under the leg limit). When fewer stops than asked fit, it says so.

**D121. Search.** Exact (depth-first with an upper bound) when there are at most 9 candidates.
Above that: greedy cheapest insertion from the fixed cities, 2-opt, then swapping stops for unused
cities, repeated until a pass finds nothing. While building, a leg over the limit is allowed but costs
10 points per km over, so the search adds cities that bridge a far start and end (Seattle to Boston
under 2,500 km goes through Denver, Minneapolis and Chicago); the result must still pass `satisfies`.
Candidates are the 14 strongest cities plus any named. Every tie breaks on city id, there is no
randomness, so the same inputs give the same route in any input order. On a test with nine cities the
heuristic is within 3% of the exact answer.

**D122. "Why not"** for the six strongest cities left off: you skipped it; within 150 km of a stop;
no position keeps both legs under your limit; or taking it instead of a stop scores N points less once
distance counts. The last is computed by trying it at every position in place of each stop you did not
require.

**D123. Scores across countries.** Qloo heatmaps are per country, so a region (United States and
Canada, UK and Ireland, Western Europe, Australia and New Zealand; one heatmap each, at most five)
scores each city against the hottest city in its own country, and the page says so. A typed city is
matched with the GeoNames matcher inside the region; names that do not match are listed, not guessed.
A named city with no Qloo heat can still be a stop (score 0), labelled.

**D124. Dates and venue sizes are the user's.** The design's "target week of …" per stop is not
built: it would suggest dates. A date window and a date per stop can be typed and show the Your data
label; until then each stop says "Date to confirm with the promoter". A venue size band per stop is
also typed by the user and never changes a score. The plan's own tour (planTour) is unchanged.
