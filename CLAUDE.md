Takeover — rules for every change
Product: market-entry agent. Input: any fanbase name. Output: crossover partner, city, venue,
sponsors, one-page brief, two outreach drafts.

Scores, rankings and numbers come ONLY from lib/engine using Qloo results. The LLM chooses tools
and writes prose; it never produces a number.

Never invent capacity, dates, prices or availability. Render them as "to confirm with the promoter".
Qloo, Gemini (and Anthropic) keys and the Upstash token stay server-side. Never send them to the
browser or log them.
The model is called only through lib/llm (provider chosen by LLM_PROVIDER, default Gemini), which
counts every call against the daily token budget.
Every Qloo call goes through lib/qloo/client.ts (cache, timeout, retry, per-run budget).
Every agent step emits an SSE event: {step, status, summary, qlooCall:{endpoint, params}, data}.
Every step has a fallback that explains what happened and continues with the best result, labelled.
Hard caps: 8 agent turns, 25 Qloo calls per run, LLM_DAILY_TOKEN_BUDGET model tokens a day.
UI follows /design (from Claude Design). Do not invent new colours or components.
Team-product work (accounts, workspaces, customer data, jobs, email, billing) also follows
docs/roadmap-rules.md; the planned architecture is docs/architecture.md.
Before finishing any task: run npm run lint && npm test.