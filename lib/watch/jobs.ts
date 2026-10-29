import "server-only";

import { featureAccess } from "@/lib/workspace/gate";

import { queueMode, type WatchRefreshMessage } from "@/lib/jobs/queue";
import { getQlooSource } from "@/lib/qloo/source";
import { jobWorkspace } from "@/lib/workspace/session";

import { runWatchWorkspace } from "./service";

const appUrl = () => process.env.APP_URL?.trim().replace(/\/$/, "") || "http://localhost:3000";

/**
 * One workspace's weekly market watch, from the queue. Acts only in the workspace named in the
 * message, as that owner, and records a job_runs row whatever happens.
 */
export async function runWatchJob(message: WatchRefreshMessage): Promise<void> {
  const now = message.asOf && queueMode() === "local" ? new Date(message.asOf) : new Date();
  const found = await jobWorkspace(message.workspaceId, message.userId);
  if (!found) {
    console.warn("[jobs] watch refresh skipped: the workspace or membership is gone");
    return;
  }
  const { repo } = found;
  // A workspace whose plan no longer includes market watch keeps its history, read-only, and spends no calls.
  if (!(await featureAccess(repo, "market.watch")).allowed) return;
  const workspace = await repo.workspace.get();
  const jobId = await repo.jobs.create({ kind: "watch.refresh", targetId: message.workspaceId, status: "running" });
  await repo.jobs.update(jobId, { startedAt: new Date() });
  try {
    const r = await runWatchWorkspace(repo, { source: getQlooSource(), now, workspaceName: workspace?.name ?? "Your workspace", appUrl: appUrl() });
    await repo.jobs.update(jobId, { status: r.skipped ? "skipped_budget" : "done", qlooCalls: r.calls, note: r.note, finishedAt: new Date() });
  } catch (err) {
    console.error("[jobs] watch refresh failed:", err instanceof Error ? err.name : "unknown");
    await repo.jobs.update(jobId, { status: "failed", note: "The weekly check failed. It runs again next week.", finishedAt: new Date() });
  }
}
