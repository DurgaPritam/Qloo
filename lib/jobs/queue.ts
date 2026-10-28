import "server-only";

import type { RefreshUnit } from "@/lib/roster/plan";

import { publishQstash } from "./qstash";

/** One staggered slice of a roster refresh, for one workspace (docs/roadmap-rules.md, rule 3). */
export interface RosterRefreshMessage {
  kind: "roster.refresh";
  jobId: string;
  workspaceId: string;
  /** Who asked; the job acts with their current role and stops if they left the workspace. */
  userId: string;
  rosterId: string;
  units: RefreshUnit[];
  force: boolean;
}

export type JobMessage = RosterRefreshMessage;

type Env = Record<string, string | undefined>;

export const JOB_PATHS: Record<JobMessage["kind"], string> = { "roster.refresh": "/api/jobs/roster-refresh" };

/**
 * QStash when it is configured; on a laptop, an in-process timer. A deployment without QStash
 * refuses (fails closed) instead of running jobs inside a request that may be cut short.
 */
export function queueMode(env: Env = process.env): "qstash" | "local" | "off" {
  if (env.QSTASH_TOKEN?.trim() && env.APP_URL?.trim()) return "qstash";
  return env.VERCEL_ENV ? "off" : "local";
}

/** Seconds between batches: Qloo answers about 10 calls a second, and a batch is up to 25. */
export function staggerSeconds(env: Env = process.env): number {
  return queueMode(env) === "qstash" ? 30 : 1;
}

export class JobsNotConfiguredError extends Error {
  constructor() {
    super("Background jobs are not set up on this deployment (QSTASH_TOKEN and APP_URL).");
    this.name = "JobsNotConfiguredError";
  }
}

export async function enqueue(message: JobMessage, delaySeconds: number, env: Env = process.env): Promise<void> {
  const mode = queueMode(env);
  if (mode === "off") throw new JobsNotConfiguredError();
  if (mode === "qstash") {
    const destination = `${env.APP_URL!.trim().replace(/\/$/, "")}${JOB_PATHS[message.kind]}`;
    await publishQstash(destination, message, { token: env.QSTASH_TOKEN!.trim(), delaySeconds, baseUrl: env.QSTASH_URL?.trim() || undefined });
    return;
  }
  setTimeout(() => {
    void import("@/lib/roster/jobs").then(({ runRosterJob }) => runRosterJob(message)).catch((err: unknown) => {
      console.error("[jobs] local job failed:", err instanceof Error ? err.message : "unknown");
    });
  }, delaySeconds * 1000);
}
