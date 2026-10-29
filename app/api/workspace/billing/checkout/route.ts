import { createCheckout, createPortal, INTERVALS, StripeError, stripeConfig, type Interval } from "@/lib/billing/stripe";
import { liveSubscription, perSeat, SELF_SERVE, type TierName } from "@/lib/entitlements";
import { can, ForbiddenError } from "@/lib/workspace/permissions";
import { appOrigin, inWorkspace, readJson } from "@/lib/workspace/route";

const MAX_SEATS = 500;

/**
 * POST {tier, interval, seats?} → {url} of a Stripe Checkout page (owners only). A workspace that
 * already pays gets the Customer Portal instead, where its plan is changed, never a second subscription.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo, ctx, user }) => {
    if (!can(ctx.role, "billing.manage")) throw new ForbiddenError("billing.manage");
    const found = stripeConfig();
    if (!found.ok) return Response.json({ error: found.reason }, { status: 503 });
    const tier = SELF_SERVE.find((t) => t === body.tier) as TierName | undefined;
    const interval = INTERVALS.find((i) => i === body.interval) as Interval | undefined;
    if (!tier || !interval) return Response.json({ error: "Pick a plan and monthly or annual." }, { status: 400 });
    try {
      const sub = await repo.billing.get();
      if (sub?.stripeCustomerId && liveSubscription(sub.status)) {
        return Response.json({ url: await createPortal(found.config, sub.stripeCustomerId, `${appOrigin(req)}/workspace/settings/billing`), portal: true });
      }
      const [members, pending] = await Promise.all([repo.members.list(), repo.invitations.listPending()]);
      const inUse = Math.max(1, members.length + pending.length);
      const asked = Number(body.seats);
      if (perSeat(tier) && Number.isInteger(asked) && asked < inUse)
        return Response.json({ error: `This workspace already uses ${inUse} ${inUse === 1 ? "seat" : "seats"}; buy at least that many.` }, { status: 400 });
      const quantity = perSeat(tier) ? Math.min(MAX_SEATS, Number.isInteger(asked) && asked > 0 ? asked : inUse) : 1;
      const url = await createCheckout(found.config, {
        workspaceId: ctx.workspaceId,
        customerId: sub?.stripeCustomerId ?? null,
        email: user.email,
        tier,
        interval,
        quantity,
        origin: appOrigin(req),
      });
      return Response.json({ url });
    } catch (err) {
      if (err instanceof StripeError) return Response.json({ error: `Stripe: ${err.message}` }, { status: 502 });
      throw err;
    }
  });
}
