/**
 * Preloads the landing examples and likely judge inputs: runs the full agent on the real Qloo
 * source, keeps every Qloo response in Redis with no expiry, and stores each finished run as a
 * replayable recording (served by /api/plan as a "cached run") and as a share-link plan.
 *
 *   npm run warm-cache                 # needs QLOO_*, UPSTASH_* and the LLM_PROVIDER's key
 *   npm run warm-cache -- --allow-scripted   # without a model key (template wording)
 *
 * Never runs in mock mode: sample data must not reach Redis.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";

import { runAgent } from "@/lib/agent/loop";
import { createPlanner } from "@/lib/agent/planner";
import { EXAMPLES, JUDGE_INPUTS } from "@/lib/examples";
import { isMockMode } from "@/lib/mock-mode";
import { QlooApiSource } from "@/lib/qloo/api";
import { createQlooClient, lastQuota } from "@/lib/qloo/client";
import { savePlan } from "@/lib/server/plan-store";
import { getRedis } from "@/lib/server/redis";
import { createRecorder, saveRecording } from "@/lib/server/replay";

async function main() {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, "..", ".env.local"));
  } catch {
    // Env may come from the shell instead.
  }
  // From a home connection, uploading large Qloo responses takes longer than the app's 1.5 s.
  process.env.TAKEOVER_REDIS_TIMEOUT_MS ??= "20000";
  if (isMockMode()) throw new Error("TAKEOVER_MOCK=1 is set: sample data must never be cached.");
  if (!getRedis()) throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are needed: nothing would persist.");
  const planner = createPlanner();
  if (planner.kind === "scripted" && !process.argv.includes("--allow-scripted")) {
    throw new Error("No model key for LLM_PROVIDER; pass --allow-scripted to preload template wording.");
  }

  const source = new QlooApiSource(createQlooClient({ ttlSeconds: 0 }));
  const inputs = [...EXAMPLES.map((e) => e.name), ...JUDGE_INPUTS];
  let stored = 0;
  for (const query of inputs) {
    const recorder = createRecorder(query);
    const plan = await runAgent({ query }, { runId: randomUUID(), source, planner, emit: recorder.emit });
    if (plan.status !== "complete") {
      console.log(`✗ ${query}: ${plan.status} (${plan.needsInput?.question ?? plan.notes.join(" ")})`);
      continue;
    }
    await saveRecording(recorder.finish(plan));
    await savePlan(plan, { forever: true });
    stored++;
    console.log(`✓ ${query}: ${plan.brief?.title} · ${plan.qlooCalls} calls`);
  }
  console.log(`\nStored ${stored} of ${inputs.length}. Qloo quota left: ${lastQuota.remaining ?? "unknown"}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
