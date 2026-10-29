import { createPortal, StripeError, stripeConfig } from "@/lib/billing/stripe";
import { can, ForbiddenError } from "@/lib/workspace/permissions";
import { appOrigin, inWorkspace } from "@/lib/workspace/route";

/** POST → {url} of Stripe's Customer Portal: change plan or seats, the card, invoices, cancel (owners only). */
export async function POST(req: Request): Promise<Response> {
  return inWorkspace(async ({ repo, ctx }) => {
    if (!can(ctx.role, "billing.manage")) throw new ForbiddenError("billing.manage");
    const found = stripeConfig();
    if (!found.ok) return Response.json({ error: found.reason }, { status: 503 });
    const sub = await repo.billing.get();
    if (!sub?.stripeCustomerId) return Response.json({ error: "This workspace has no subscription yet. Pick a plan first." }, { status: 400 });
    try {
      return Response.json({ url: await createPortal(found.config, sub.stripeCustomerId, `${appOrigin(req)}/workspace/settings/billing`) });
    } catch (err) {
      if (err instanceof StripeError) return Response.json({ error: `Stripe: ${err.message}` }, { status: 502 });
      throw err;
    }
  });
}
