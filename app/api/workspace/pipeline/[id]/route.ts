import { InputError } from "@/lib/db/scoped";
import { isStage } from "@/lib/pipeline/stages";
import { inWorkspace, readJson } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/**
 * GET → a card and its history. PATCH {stage, seenHash?} moves it ("sent" needs the hash of the
 * draft the user saw); PATCH {draft} edits a draft. DELETE removes the card.
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return inWorkspace(async ({ repo }) => {
    const found = await repo.pipeline.get(id);
    return found ? Response.json(found) : Response.json({ error: "That card isn't in this workspace." }, { status: 404 });
  });
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    if (body.draft && typeof body.draft === "object") {
      const d = body.draft as Record<string, unknown>;
      const email = text(d.recipientEmail, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("That email address doesn't look right.");
      const fields = { recipient: text(d.recipient, 200), recipientEmail: email || null, subject: text(d.subject, 300), body: text(d.body, 10_000) };
      if (!fields.recipient || !fields.subject || !fields.body) throw new InputError("A draft needs a recipient, a subject and a body.");
      await repo.pipeline.edit(id, fields);
      return Response.json({ ok: true });
    }
    if (!isStage(body.stage)) throw new InputError("Unknown stage.");
    await repo.pipeline.move(id, body.stage, typeof body.seenHash === "string" ? body.seenHash : undefined);
    return Response.json({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return inWorkspace(async ({ repo }) => {
    await repo.pipeline.remove(id);
    return Response.json({ ok: true });
  });
}
