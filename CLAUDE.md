Takeover — rules for every change
Product: market-entry agent. Input: any fanbase name. Output: crossover partner, city, venue,
sponsors, one-page brief, two outreach drafts.

Scores, rankings and numbers come ONLY from lib/engine using Qloo results. The LLM chooses tools
and writes prose; it never produces a number.

Never invent capacity, dates, prices or availability. Render them as "to confirm with the promoter".
Qloo key and Anthropic key stay server-side. Never send them to the browser or log them.
Every Qloo call goes through lib/qloo/client.ts (cache, timeout, retry, per-run budget).
Every agent step emits an SSE event: {step, status, summary, qlooCall:{endpoint, params}, data}.
Every step has a fallback that explains what happened and continues with the best result, labelled.
Hard caps: 8 agent turns, 25 Qloo calls per run.
UI follows /design (from Claude Design). Do not invent new colours or components.
Before finishing any task: run npm run lint && npm test.