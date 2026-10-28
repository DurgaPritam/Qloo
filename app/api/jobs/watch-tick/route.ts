import { verifyQstashSignature } from "@/lib/jobs/qstash";
import { enqueue, queueMode } from "@/lib/jobs/queue";
import { isE2eRequest } from "@/lib/server/rate-limit";
import { scheduleWatchJobs } from "@/lib/watch/service";
import { reminderWorkspaces, watchWorkspacesDue } from "@/lib/workspace/session";

/**
 * The tick (an hourly QStash schedule): one staggered job per workspace with a watch due. Items
 * fall due on Monday 07:00 in their workspace's time zone, so hourly catches every zone.
 * Locally there is no scheduler, so a request carrying the e2e token may run it, optionally as of
 * a later date ({now}) to stand in for next Monday.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  let now = new Date();
  let asOf: Date | undefined;
  if (queueMode() === "qstash") {
    const url = `${process.env.APP_URL!.trim().replace(/\/$/, "")}/api/jobs/watch-tick`;
    if (!verifyQstashSignature(req.headers.get("upstash-signature"), body, { url, keys: [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY] })) {
      return Response.json({ error: "Bad signature." }, { status: 401 });
    }
  } else if (queueMode() === "local" && isE2eRequest(req.headers)) {
    const at = (JSON.parse(body || "{}") as { now?: string }).now;
    if (at && !Number.isNaN(Date.parse(at))) now = asOf = new Date(at);
  } else {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const due = await watchWorkspacesDue(now);
  const queued = await scheduleWatchJobs(due, asOf);
  // The same tick sends overdue pipeline reminders (no Qloo calls).
  const reminders = await reminderWorkspaces(now);
  for (const [i, r] of reminders.entries()) await enqueue({ kind: "pipeline.reminders", workspaceId: r.workspaceId, userId: r.userId, ...(asOf ? { asOf: asOf.toISOString() } : {}) }, i);
  return Response.json({ queued, reminders: reminders.length });
}
