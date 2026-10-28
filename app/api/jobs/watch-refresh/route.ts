import { verifyQstashSignature } from "@/lib/jobs/qstash";
import { JOB_PATHS, queueMode, type WatchRefreshMessage } from "@/lib/jobs/queue";
import { runWatchJob } from "@/lib/watch/jobs";

/** QStash delivers one workspace's weekly market watch here. Signed calls only; outcomes are recorded on job_runs. */
export async function POST(req: Request): Promise<Response> {
  if (queueMode() !== "qstash") return Response.json({ error: "Not found." }, { status: 404 });
  const body = await req.text();
  const url = `${process.env.APP_URL!.trim().replace(/\/$/, "")}${JOB_PATHS["watch.refresh"]}`;
  if (!verifyQstashSignature(req.headers.get("upstash-signature"), body, { url, keys: [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY] })) {
    return Response.json({ error: "Bad signature." }, { status: 401 });
  }
  const message = JSON.parse(body) as WatchRefreshMessage;
  if (message?.kind !== "watch.refresh" || typeof message.workspaceId !== "string" || typeof message.userId !== "string") {
    return Response.json({ error: "Unknown job." }, { status: 400 });
  }
  await runWatchJob(message);
  return Response.json({ ok: true });
}
