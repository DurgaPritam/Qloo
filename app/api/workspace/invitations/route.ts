import { planOf, withinLimit } from "@/lib/workspace/gate";
import { linkEmail, sendEmail } from "@/lib/email/mailer";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";
import { appOrigin, inWorkspace, readJson, inFeature } from "@/lib/workspace/route";
import { ROLE_LABEL } from "@/lib/workspace/permissions";

/**
 * POST {email, role} → invites someone and emails them the link (the inviter's click on
 * "Send invite" is the explicit action rule 5 asks for). POST {action: "revoke", id} → cancels.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  // Cancelling an invitation is always allowed, whatever the plan.
  if (body.action === "revoke") {
    return inWorkspace(async ({ repo }) => {
      if (typeof body.id !== "string") return Response.json({ error: "Send id." }, { status: 400 });
      await repo.invitations.revoke(body.id);
      return Response.json({ ok: true });
    });
  }
  return inFeature("team.seats", async ({ repo, user, ctx, memberships }) => {
    const [members, pending] = await Promise.all([repo.members.list(), repo.invitations.listPending()]);
    withinLimit(await planOf(repo), "seats", members.length + pending.length, `Every seat on this plan is taken (members and pending invitations).`);
    const role = body.role === "admin" || body.role === "member" || body.role === "viewer" ? body.role : null;
    if (typeof body.email !== "string" || !role) return Response.json({ error: "Send an email and a role." }, { status: 400 });
    if (!isE2eRequest(req.headers)) {
      const limit = await getLimiters().emails.check(visitorId(req.headers));
      if (!limit.ok) return Response.json({ error: "Too many emails sent this hour. Try again later." }, { status: 429 });
    }
    const invite = await repo.invitations.create(body.email, role);
    const workspace = memberships.find((m) => m.workspaceId === ctx.workspaceId)?.name ?? "a workspace";
    const who = user.name || user.email || "A teammate";
    try {
      await sendEmail(
        linkEmail({
          to: invite.email,
          subject: `${who} invited you to ${workspace} on Takeover`,
          intro: `${who} invited you to join ${workspace} on Takeover as ${ROLE_LABEL[role].toLowerCase()}. Takeover plans events from Qloo taste data.`,
          button: "Accept the invitation",
          url: `${appOrigin(req)}/invite/${invite.token}`,
          outro: `Sign in with ${invite.email} to accept. The link expires in 7 days.`,
        }),
      );
    } catch (err) {
      await repo.invitations.revoke(invite.id);
      console.error("[invitations] email failed:", err instanceof Error ? err.name : "unknown");
      return Response.json({ error: "The invitation email could not be sent, so the invitation was cancelled. Try again." }, { status: 502 });
    }
    return Response.json({ ok: true, id: invite.id });
  });
}
