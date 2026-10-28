import { verifyQstashSignature } from "@/lib/jobs/qstash";
import { JOB_PATHS, queueMode, type PipelineRemindersMessage } from "@/lib/jobs/queue";
import { runRemindersJob } from "@/lib/pipeline/reminders";

/** QStash delivers one workspace's overdue-card reminders here. Signed calls only. */
export async function POST(req: Request): Promise<Response> {
  if (queueMode() !== "qstash") return Response.json({ error: "Not found." }, { status: 404 });
  const body = await req.text();
  const url = `${process.env.APP_URL!.trim().replace(/\/$/, "")}${JOB_PATHS["pipeline.reminders"]}`;
  if (!verifyQstashSignature(req.headers.get("upstash-signature"), body, { url, keys: [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY] })) {
    return Response.json({ error: "Bad signature." }, { status: 401 });
  }
  const message = JSON.parse(body) as PipelineRemindersMessage;
  if (message?.kind !== "pipeline.reminders" || typeof message.workspaceId !== "string" || typeof message.userId !== "string") {
    return Response.json({ error: "Unknown job." }, { status: 400 });
  }
  await runRemindersJob(message);
  return Response.json({ ok: true });
}
