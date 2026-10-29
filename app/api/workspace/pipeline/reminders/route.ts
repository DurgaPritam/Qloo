import { readJson, inFeature } from "@/lib/workspace/route";

/** POST {enabled} → turns the caller's overdue-card reminder emails on or off (in-app reminders are always on). */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inFeature("pipeline", async ({ repo }) => {
    await repo.digest.setReminders(body.enabled === true);
    return Response.json({ ok: true });
  });
}
