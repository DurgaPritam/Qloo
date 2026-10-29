import { InputError } from "@/lib/db/scoped";
import { isStage } from "@/lib/pipeline/stages";
import { inWorkspace, readJson, inFeature } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/**
 * GET → a card, its history and its comments. PATCH {stage, seenHash?} moves it ("sent" needs the
 * hash of the draft the user saw); PATCH {draft} edits a draft; PATCH {track: {contactName, dueDate,
 * notes}} sets the tracking fields; PATCH {ownerId} reassigns it. DELETE removes the card.
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return inWorkspace(async ({ repo }) => {
    const found = await repo.pipeline.get(id);
    if (!found) return Response.json({ error: "That card isn't in this workspace." }, { status: 404 });
    return Response.json({ ...found, comments: await repo.pipeline.comments(id) });
  });
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = await readJson(req);
  return inFeature("pipeline", async ({ repo }) => {
    if (body.draft && typeof body.draft === "object") {
      const d = body.draft as Record<string, unknown>;
      const email = text(d.recipientEmail, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("That email address doesn't look right.");
      const fields = { recipient: text(d.recipient, 200), recipientEmail: email || null, subject: text(d.subject, 300), body: text(d.body, 10_000) };
      if (!fields.recipient || !fields.subject || !fields.body) throw new InputError("A draft needs a recipient, a subject and a body.");
      await repo.pipeline.edit(id, fields);
      return Response.json({ ok: true });
    }
    if (body.track && typeof body.track === "object") {
      const t = body.track as Record<string, unknown>;
      const due = text(t.dueDate, 10);
      if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due)))) throw new InputError("Pick a due date from the calendar.");
      await repo.pipeline.track(id, { contactName: text(t.contactName, 120) || null, dueDate: due || null, notes: text(t.notes, 4000) || null });
      return Response.json({ ok: true });
    }
    if (typeof body.ownerId === "string") {
      await repo.pipeline.assign(id, body.ownerId);
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
