import "server-only";

import { runAgent } from "@/lib/agent/loop";
import { createPlanner } from "@/lib/agent/planner";
import type { PlanCreateMessage } from "@/lib/jobs/queue";
import { getQlooSource } from "@/lib/qloo/source";
import { jobWorkspace } from "@/lib/workspace/session";

/**
 * A plan from the public API: the same agent as the site, on the workspace's Qloo allowance, saved
 * to the workspace (private by default). The job row says queued → running → done or failed.
 */
export async function runPlanJob(message: PlanCreateMessage): Promise<void> {
  const found = await jobWorkspace(message.workspaceId, message.userId);
  if (!found) return;
  const { repo } = found;
  await repo.jobs.update(message.jobId, { status: "running", startedAt: new Date() });
  try {
    const plan = await runAgent(
      { query: message.query },
      {
        runId: message.planId,
        overrides: message.entityId ? { entityId: message.entityId } : undefined,
        source: getQlooSource(),
        planner: createPlanner(),
        emit: () => {},
        scope: { kind: "workspace", workspaceId: message.workspaceId },
      },
    );
    await repo.plans.create({ id: plan.runId, query: message.query, result: plan });
    await repo.jobs.update(message.jobId, { status: "done", qlooCalls: plan.qlooCalls, note: plan.status === "complete" ? "Plan complete." : `Plan stopped early: ${plan.status}.`, finishedAt: new Date() });
  } catch (err) {
    console.error("[jobs] api plan failed:", err instanceof Error ? err.name : "unknown");
    await repo.jobs.update(message.jobId, { status: "failed", note: "The plan could not be made. Try again.", finishedAt: new Date() });
  }
}
