import { runPlanJob } from "@/lib/api/plan-job";
import { verifyQstashSignature } from "@/lib/jobs/qstash";
import { JOB_PATHS, queueMode, type PlanCreateMessage } from "@/lib/jobs/queue";

export const maxDuration = 300;

/** QStash delivers a public API plan here. Signed calls only. */
export async function POST(req: Request): Promise<Response> {
  if (queueMode() !== "qstash") return Response.json({ error: "Not found." }, { status: 404 });
  const body = await req.text();
  const url = `${process.env.APP_URL!.trim().replace(/\/$/, "")}${JOB_PATHS["plan.create"]}`;
  if (!verifyQstashSignature(req.headers.get("upstash-signature"), body, { url, keys: [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY] })) {
    return Response.json({ error: "Bad signature." }, { status: 401 });
  }
  const message = JSON.parse(body) as PlanCreateMessage;
  if (message?.kind !== "plan.create" || typeof message.workspaceId !== "string" || typeof message.planId !== "string") return Response.json({ error: "Unknown job." }, { status: 400 });
  await runPlanJob(message);
  return Response.json({ ok: true });
}
