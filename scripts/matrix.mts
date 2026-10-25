/**
 * The playbook's Step 7 test matrix against a running app (default http://localhost:3400).
 * API rows only; UI rows are in e2e/matrix.spec.ts. Results feed docs/test-results.md.
 *
 *   MATRIX_URL=http://localhost:3400 MATRIX_TOKEN=… npx tsx scripts/matrix.mts
 */
import type { AgentEvent, Plan } from "@/lib/agent/types";

const BASE = process.env.MATRIX_URL ?? "http://localhost:3400";
const TOKEN = process.env.MATRIX_TOKEN ?? "";

async function plan(query: string, overrides?: Record<string, string>, opts: { token?: boolean; ip?: string } = {}) {
  const t = Date.now();
  const res = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": opts.ip ?? "198.51.100.10",
      ...(opts.token === false || !TOKEN ? {} : { "x-takeover-e2e": TOKEN }),
    },
    body: JSON.stringify({ query, overrides }),
  });
  if (!res.ok) return { status: res.status, body: await res.json(), ms: Date.now() - t };
  const events = (await res.text())
    .split("\n\n")
    .map((c) => c.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)) as AgentEvent);
  const final = events.at(-1)!;
  return { status: 200, final, plan: final.data as Plan | undefined, events, ms: Date.now() - t };
}

function describe(p?: Plan): string {
  if (!p) return "no plan";
  if (p.status === "needs_input") return `needs input (${p.needsInput?.kind}): ${p.needsInput?.choices.map((c) => `${c.name} [${c.category}]`).join(" | ") || "no choices"}`;
  const partner = p.partners?.picks.find((x) => x.pick.entity.id === p.partners?.chosenId)?.pick.entity;
  const city = p.city?.chosen?.pick;
  return [
    `${p.fanbase?.name} [${p.fanbase?.category}]`,
    p.format?.label,
    partner ? `partner ${partner.name} [${partner.category}] pop ${partner.popularity.toFixed(3)}` : "no partner",
    city ? `${city.city.name} (${p.city?.market.code}) Qloo #${city.rank} / pop #${city.populationRank}${p.city?.basis === "fanbase" ? " fanbase-only" : ""}${p.city?.level === "region" ? " regional" : ""}` : "no city",
    p.room?.venue ? `venue ${p.room.venue.pick.place.name}` : "no venue",
    `sponsors ${p.room?.sponsors.map((s) => s.pick.brand.name).join(", ") || "-"}`,
    `${p.status}, ${p.qlooCalls} calls`,
  ].join(" · ");
}

const rows: Array<[string, string]> = [
  ["Famous comedian", "John Mulaney"],
  ["Famous artist", "Sabrina Carpenter"],
  ["Film", "Sinners"],
  ["Podcast", "Call Her Daddy"],
  ["Premier League club", "Arsenal"],
  ["US team", "Golden State Warriors"],
  ["Misspelling", "Kevn Hart"],
  ["Misspelling", "Billie Elish"],
  ["Ambiguous name", "Selena"],
  ["Formerly ambiguous (video game now excluded)", "Mercury"],
  ["Nonsense", "asdfgh"],
  ["Niche act", "Black Country, New Road"],
  ["Non-English (Arabic)", "أم كلثوم"],
  ["Non-English (Hindi)", "अरिजीत सिंह"],
];

for (const [label, q] of rows) {
  const r = await plan(q);
  const fallbacks = (r.events ?? []).filter((e) => e.status === "fallback" && e.step !== "final").map((e) => `${e.step}: ${e.fallback ?? e.summary}`);
  console.log(`\n${label} · "${q}" · ${(r.ms / 1000).toFixed(1)}s`);
  console.log(`  ${r.status === 200 ? describe(r.plan) : `HTTP ${r.status} ${JSON.stringify(r.body)}`}`);
  if (fallbacks.length) console.log(`  fallbacks: ${fallbacks.join(" | ")}`);
  // Resume the pickers with the first choice.
  const choice = r.plan?.needsInput?.choices[0];
  if (choice) {
    const resumed = await plan(q, { entityId: choice.entityId });
    console.log(`  resumed with ${choice.name}: ${describe(resumed.plan)}`);
  }
}

const RATE_IP = `203.0.113.${Math.floor(Math.random() * 250)}`;
console.log("\nRate limit · 6 fresh runs without the test token");
for (let i = 1; i <= 6; i++) {
  const r = await plan("asdfgh", undefined, { token: false, ip: RATE_IP });
  console.log(`  run ${i}: ${r.final?.status} ${r.final?.status === "error" ? `"${r.final.summary}"` : ""}`);
}

console.log("\nLLM-only toggle");
const llm = await fetch(`${BASE}/api/llm-only`, { method: "POST", headers: { "content-type": "application/json", "x-takeover-e2e": TOKEN }, body: JSON.stringify({ query: "John Mulaney" }) });
console.log(`  HTTP ${llm.status} ${JSON.stringify(await llm.json()).slice(0, 200)}`);

const health = await (await fetch(`${BASE}/api/health`)).json();
console.log(`\nquota left ${health.qloo.quotaRemaining}`);
