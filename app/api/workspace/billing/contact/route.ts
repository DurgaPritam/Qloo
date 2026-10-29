import { escapeHtml, sendEmail } from "@/lib/email/mailer";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";
import { contactAddress } from "@/lib/billing/contact";
import { inWorkspace, readJson } from "@/lib/workspace/route";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/**
 * POST {name, company, message} → emails Takeover about Enterprise (sent only on the user's click).
 * Enterprise is then assigned by hand; nothing changes in the workspace from here.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  const name = clip(body.name, 100);
  const company = clip(body.company, 120);
  const message = clip(body.message, 2000);
  if (!name || !message) return Response.json({ error: "Add your name and a short message." }, { status: 400 });
  return inWorkspace(async ({ user, ctx, memberships }) => {
    const to = contactAddress();
    if (!to) return Response.json({ error: "The contact form isn't set up yet." }, { status: 503 });
    if (!isE2eRequest(req.headers)) {
      const limit = await getLimiters().emails.check(visitorId(req.headers));
      if (!limit.ok) return Response.json({ error: "Too many emails sent this hour. Try again later." }, { status: 429 });
    }
    const workspace = memberships.find((m) => m.workspaceId === ctx.workspaceId)?.name ?? "";
    const lines = [`Name: ${name}`, `Company: ${company || "—"}`, `Email: ${user.email ?? "—"}`, `Workspace: ${workspace} (${ctx.workspaceId})`, "", message];
    await sendEmail({
      to,
      subject: `Enterprise enquiry from ${company || name}`,
      text: lines.join("\n"),
      html: `<p>${lines.map(escapeHtml).join("<br>")}</p>`,
      ...(user.email ? { headers: { "Reply-To": user.email } } : {}),
    });
    return Response.json({ ok: true });
  });
}
