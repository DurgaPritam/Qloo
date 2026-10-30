# Upstash timeouts: what main does, and the smallest fix

Branch `investigate/redis-calls`, cut from `main` (b5bbc0c) on 28 Oct 2026. **Not merged anywhere.**
Measured on a local production build of main in live mode, with a preload that logs every request
the server sends to Upstash (command, key prefix, sizes, time; never the token or values). Redis
timeout is main's default, 4 s. Measured from a laptop: a Vercel function in Upstash's region will
be faster, so read the sizes as the cause and the times as the worst case.

## What main does today

| Request | HTTP requests | Commands | Data read | Data written | Timeouts |
|---|---|---|---|---|---|
| Landing page (every load) | 6–8 | 33, of which 28 are recording reads | ~2.4 MB asked for in one pipeline | – | 1 per load |
| Replayed example run | 1–3 | 1–3 | ~85 KB | – | 0 |
| Fresh plan run (10 Qloo calls) | 23 | 28 | small | 4.35 MB (cached Qloo answers, 0.25–1.3 MB each) | 1 |
| Plan run from cached Qloo answers | 19 | 24 | 2.2 MB | – | 2 (each falls back to Qloo: 5 extra calls) |
| `/api/health` | 2 | 3 | tiny | – | 0 |

**The number of calls is not the problem: the size of the batches and values is.**

1. **Landing page.** `loadShowcase` and `dailyPuzzle` each read the 14 showcase recordings
   (`takeover:replay:v1:*`, ~85 KB each: full event logs). `loadRecording` never keeps a Redis
   read in memory, so every landing load reads all 28 again. The client's auto-pipelining merges
   them into **one** HTTP response of ~2.4 MB, which cannot arrive in 4 s; `loadRecording` then
   returns null for all of them, so the showcase and the Daily round can render empty.
2. **Large cached Qloo answers.** The Qloo cache stores raw responses: a US heatmap is 1.3–2.8 MB
   (3,000+ cells of ~130 bytes of JSON each), insights 0.25–0.8 MB. One GET of a heatmap times out
   on its own; the run then calls Qloo again (still correct, but it costs quota and time).

## Proposed change (on this branch, 2 files, +30 −6)

- `lib/server/replay.ts`: keep a recording in memory once read (they never change after saving;
  at most 100, ~8.5 MB), and share in-flight reads, so the showcase and the Daily puzzle read each
  recording once.
- `lib/server/redis.ts`: `enableAutoPipelining: false`. Concurrent reads go as parallel small
  requests instead of one oversized response. **Upstash counts commands, not HTTP requests, so
  this does not raise usage.**

Measured with the change:

| Request | Commands | Data read | Timeouts | Page time |
|---|---|---|---|---|
| Landing, first load on a fresh server | 20 | 1.2 MB (14 recordings, in parallel) | 0 | 1.9 s |
| Landing, later loads | 6 | 1.9 KB | 0 | 0.4–0.6 s |
| Replayed example run | 1 | 85 KB | 0 | – |

Main's 200 unit tests pass on the branch. The memory part alone is not enough: without turning
auto-pipelining off, the 14 reads still arrive as one 1.2 MB response and time out every time,
so nothing is ever kept.

## Not changed: the large Qloo cache values

Plan runs still time out on single 1.3–2.8 MB heatmap reads (from a laptop). Options, smallest
first, for after you have checked the plan's limits:
1. Measure on Vercel first (same region as Upstash); it may simply be fast enough there.
2. Raise `TAKEOVER_REDIS_TIMEOUT_MS` on Vercel (configuration only, no code).
3. Cache heatmaps compactly: `[lat, lon, affinity, popularity]` per cell instead of Qloo's JSON,
   about 4× smaller (a 2.8 MB heatmap to ~0.7 MB). A code change in `lib/qloo/client.ts`'s cache
   path, with a new cache key version.

## Numbers to check against the Upstash plan

- Commands: about 33 per landing load today (6 with the change, after the first), ~28 per fresh
  plan run, ~3 per health check, 1–3 per replayed example.
- Request size: the largest single value written is a **2.8 MB** heatmap (SET succeeded); the
  largest response asked for was **~2.4 MB** (the landing pipeline).
- Bandwidth: a fresh plan run writes ~4.4 MB; a cold landing load reads ~1.2–2.4 MB.
