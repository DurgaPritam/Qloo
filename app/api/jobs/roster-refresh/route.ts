import { verifyQstashSignature } from "@/lib/jobs/qstash";
import { JOB_PATHS, queueMode, type RosterRefreshMessage } from "@/lib/jobs/queue";
import { runRosterJob } from "@/lib/roster/jobs";

/**
 * QStash delivers staggered roster refresh batches here. Only signed calls are accepted. The
 * outcome is recorded on the job's row, so the answer is 200 even when the batch was skipped:
 * QStash retries only when this route crashes.
 */
export async function POST(req: Request): Promise<Response> {
  if (queueMode() !== "qstash") return Response.json({ error: "Not found." }, { status: 404 });
  const body = await req.text();
  const url = `${process.env.APP_URL!.trim().replace(/\/$/, "")}${JOB_PATHS["roster.refresh"]}`;
  const ok = verifyQstashSignature(req.headers.get("upstash-signature"), body, {
    url,
    keys: [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY],
  });
  if (!ok) return Response.json({ error: "Bad signature." }, { status: 401 });
  const message = JSON.parse(body) as RosterRefreshMessage;
  if (message?.kind !== "roster.refresh" || typeof message.workspaceId !== "string" || typeof message.jobId !== "string") {
    return Response.json({ error: "Unknown job." }, { status: 400 });
  }
  await runRosterJob(message);
  return Response.json({ ok: true });
}
