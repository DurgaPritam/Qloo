import "server-only";

import { featureAccess } from "@/lib/workspace/gate";

import type { RosterRefreshMessage } from "@/lib/jobs/queue";
import { getQlooSource } from "@/lib/qloo/source";
import { can } from "@/lib/workspace/permissions";
import { jobWorkspace } from "@/lib/workspace/session";

import { batchNote, runBatch } from "./service";

/**
 * One staggered batch of a roster refresh, from the job queue. It acts for the workspace in the
 * message only, as the member who asked (with their role now), and records what happened on the
 * job's row whatever the outcome. A job that is no longer queued (a QStash retry) does nothing.
 */
export async function runRosterJob(message: RosterRefreshMessage): Promise<void> {
  const found = await jobWorkspace(message.workspaceId, message.userId);
  if (!found) {
    console.warn("[jobs] roster refresh skipped: the workspace or membership is gone");
    return;
  }
  const { repo } = found;
  const job = await repo.jobs.get(message.jobId);
  if (!job || job.status !== "queued" || job.targetId !== message.rosterId) return;
  const fail = (note: string) => repo.jobs.update(job.id, { status: "failed", note, finishedAt: new Date() });
  if (!can(found.ctx.role, "roster.edit")) return void (await fail("The member who asked can no longer edit rosters."));
  if (!(await repo.rosters.get(message.rosterId))) return void (await fail("The roster was deleted."));
  if (!(await featureAccess(repo, "rosters")).allowed) return void (await fail("This workspace's plan no longer includes roster intelligence; the roster stays readable."));

  await repo.jobs.update(job.id, { status: "running", startedAt: new Date() });
  try {
    const result = await runBatch(repo, message.rosterId, message.units, {
      source: getQlooSource(),
      scope: { kind: "job", workspaceId: message.workspaceId },
      fresh: message.force,
    });
    await repo.jobs.update(job.id, { status: result.budget ? "skipped_budget" : "done", qlooCalls: result.calls, note: batchNote(result), finishedAt: new Date() });
  } catch (err) {
    console.error("[jobs] roster refresh failed:", err instanceof Error ? err.name : "unknown");
    await fail("The refresh failed. Try again later.");
  }
}
