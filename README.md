# Qloo

> Work in progress. Feature code has not been written yet.

A Next.js (App Router) app that combines the Qloo Taste AI API with a Claude-driven agent to build plans, alongside an LLM-only route for comparison.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- ESLint
- Vitest

## Layout

| Path | Purpose |
| --- | --- |
| `lib/qloo/` | Qloo API client |
| `lib/engine/` | Scoring logic (pure functions) |
| `lib/agent/` | Agent tool loop and tool definitions |
| `app/api/plan/` | Plan route (Server-Sent Events) |
| `app/api/llm-only/` | LLM-only comparison route |
| `components/` | React components |
| `tests/` | Vitest tests |
| `scripts/` | Dev and maintenance scripts |

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev                  # http://localhost:3000
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run typecheck` | Type-check with `tsc --noEmit` |

## Environment

See `.env.example`: `QLOO_API_KEY`, `QLOO_BASE_URL`, `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

## Data credits

City names, regions, coordinates and populations come from [GeoNames](https://www.geonames.org/)
(`cities15000`), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). We keep
cities with population of 100,000 or more in `lib/engine/data/cities.json`; regenerate it with
`npx tsx scripts/build-cities.ts`.

## License

MIT. See [LICENSE](LICENSE). Third-party data keeps its own licence (see Data credits).
