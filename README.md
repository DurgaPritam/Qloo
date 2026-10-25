# Qloo

> Work in progress. Feature code has not been written yet.

A Next.js (App Router) app that combines the Qloo Taste AI API with a model-driven agent (Gemini by default) to build plans, alongside an LLM-only route for comparison.

## Built with

- [Qloo Taste AI API](https://docs.qloo.com/): every partner, city, venue, opener and sponsor
- Gemini (`gemini-3.8-flash`) through the official [Google Gen AI SDK](https://www.npmjs.com/package/@google/genai): the agent picks tools and writes the brief's prose; Claude is supported as an alternative (`LLM_PROVIDER=anthropic`)
- Next.js (App Router) + TypeScript, Tailwind CSS
- Upstash Redis: Qloo cache, rate limits, the daily token budget and preloaded examples
- Vitest and Playwright

## Layout

| Path | Purpose |
| --- | --- |
| `lib/qloo/` | Qloo API client |
| `lib/engine/` | Scoring logic (pure functions) |
| `lib/agent/` | Agent tool loop and tool definitions |
| `lib/llm/` | Model providers (Gemini, Anthropic) and the daily token budget |
| `app/api/plan/` | Plan route (Server-Sent Events) |
| `app/api/llm-only/` | LLM-only comparison route |
| `components/` | React components |
| `tests/` | Vitest tests |
| `scripts/` | Dev and maintenance scripts |

## Getting started

```bash
npm ci                       # installs exactly the lockfile; `npm install` can drop native bindings (npm bug 4828)
cp .env.example .env.local   # then fill in the keys, or skip and use mock mode:
TAKEOVER_MOCK=1 npm run dev  # http://localhost:3000, sample data
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Start the dev server (`TAKEOVER_MOCK=1 npm run dev` for sample data) |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run test:e2e` | Playwright end-to-end tests; builds and starts the app in mock mode (or set `PLAYWRIGHT_BASE_URL`) |
| `npm run probe` | Record raw Qloo responses into `tests/fixtures/` (needs a key) |
| `npm run scan:secrets` | Fail if a key or `.env` file is in the bundles or the repo (run after build) |
| `npm run warm-cache` | Preload example runs into Redis (stub until the probe runs) |

## API

| Route | Does |
| --- | --- |
| `POST /api/plan` | `{query, overrides?}` → SSE stream of agent events and a final plan |
| `POST /api/llm-only` | `{query}` → the same model's answer with no tools or Qloo data |
| `GET /api/health` | Qloo reachability, Redis status, limits, remaining daily runs, the model and today's token use against the budget; no secrets |

## Environment

See `.env.example`: `QLOO_API_KEY`, `QLOO_BASE_URL`, `LLM_PROVIDER` (`gemini`, the default, or `anthropic`), `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`), `GEMINI_MODEL`, `LLM_DAILY_TOKEN_BUDGET` (default 2,000,000), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, plus `TAKEOVER_MOCK` and `TAKEOVER_DAILY_RUNS`. Without the selected provider's key the agent runs a scripted planner with template prose locally and in previews; in production that is a configuration error instead. Once the day's token budget is spent, live runs pause and the cached examples still work. Without Upstash, caches, limits and the token count fall back to memory.

## Data credits

City names, regions, coordinates and populations come from [GeoNames](https://www.geonames.org/)
(`cities15000`), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). We keep
cities with population of 100,000 or more in `lib/engine/data/cities.json`; regenerate it with
`npx tsx scripts/build-cities.ts`.

Map outlines come from [Natural Earth](https://www.naturalearthdata.com/) (public domain) via
[world-atlas](https://github.com/topojson/world-atlas) (ISC), served from `public/geo/`.

## License

MIT. See [LICENSE](LICENSE). Third-party data keeps its own licence (see Data credits).
