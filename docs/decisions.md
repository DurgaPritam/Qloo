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
