/**
 * Runs the agent once per query against the configured source (real Qloo unless TAKEOVER_MOCK=1)
 * and prints each step, the Qloo calls used and the monthly quota left. Local diagnostics only.
 *
 *   npx tsx --conditions=react-server scripts/run-real.mts "John Mulaney" ["Sabrina Carpenter" …]
 */
import path from "node:path";

import { runAgent } from "../lib/agent/loop";
import { createPlanner } from "../lib/agent/planner";
import type { Plan } from "../lib/agent/types";
import { lastQuota } from "@/lib/qloo/client";
import { getQlooSource } from "../lib/qloo/source";

process.loadEnvFile(path.resolve(import.meta.dirname, "..", ".env.local"));

export async function runOnce(query: string, overrides = {}): Promise<Plan> {
  const started = Date.now();
  const plan = await runAgent(
    { query },
    {
      runId: `local-${Date.now()}`,
      source: getQlooSource(),
      planner: createPlanner(),
      overrides,
      emit: (e) => {
        if (e.status === "running" || e.step === "final") return;
        const fb = e.fallback ? `  [fallback: ${e.fallback}]` : "";
        console.log(`  ${e.step.padEnd(9)} ${e.status.padEnd(11)} ${e.summary}${fb}`);
      },
    },
  );
  console.log(
    `  -> ${plan.status} · ${plan.model ?? plan.planner} · ${plan.qlooCalls} Qloo calls · ${((Date.now() - started) / 1000).toFixed(1)}s · quota left ${lastQuota.remaining ?? "?"}`,
  );
  return plan;
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  for (const q of process.argv.slice(2)) {
    console.log(`\n### ${q}`);
    await runOnce(q);
  }
}
