import { EMAIL_THEMES, type EmailTheme } from "@/lib/email/digest-html";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";
import { sendTestDigest } from "@/lib/watch/service";
import { appOrigin, readJson, inFeature } from "@/lib/workspace/route";

/**
 * POST {enabled} turns the caller's own weekly digest on or off; {theme} sets how it looks;
 * {test: true} emails them this week's digest now.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inFeature("market.watch", async ({ repo, user, memberships, ctx }) => {
    if (body.test === true) {
      if (!user.email) return Response.json({ error: "Your account has no email address." }, { status: 400 });
      if (!isE2eRequest(req.headers)) {
        const limit = await getLimiters().emails.check(visitorId(req.headers));
        if (!limit.ok) return Response.json({ error: "Too many emails this hour. Try again later." }, { status: 429 });
      }
      const name = memberships.find((m) => m.workspaceId === ctx.workspaceId)?.name ?? "Your workspace";
      await sendTestDigest(repo, { email: user.email, workspaceName: name, appUrl: appOrigin(req), now: new Date() });
      return Response.json({ ok: true, to: user.email });
    }
    if (typeof body.theme === "string") {
      if (!(EMAIL_THEMES as readonly string[]).includes(body.theme)) return Response.json({ error: "Pick Light, Dark or Gen Z." }, { status: 400 });
      await repo.digest.setTheme(body.theme as EmailTheme);
      return Response.json({ ok: true, theme: body.theme });
    }
    if (typeof body.enabled !== "boolean") return Response.json({ error: "Say on or off." }, { status: 400 });
    await repo.digest.set(body.enabled);
    return Response.json({ ok: true, enabled: body.enabled });
  });
}
