import { retrieveCheckout, retrieveSubscription, stripeConfig, subscriptionChange } from "@/lib/billing/stripe";
import { can } from "@/lib/workspace/permissions";
import { inWorkspace } from "@/lib/workspace/route";
import { syncSubscription } from "@/lib/workspace/tier";

/**
 * GET ?session_id= (back from Checkout) or ?from=portal (back from the Customer Portal): reads the
 * subscription from Stripe and applies it to the current workspace at once, so the new plan's
 * features unlock (or a cancellation applies) without waiting for the webhook, then goes to the
 * billing page. If Stripe can't be read, the webhook still applies the change moments later.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  const back = (q: string) => Response.redirect(new URL(`/workspace/settings/billing?${q}`, url), 303);
  return inWorkspace(async ({ repo, ctx }) => {
    const found = stripeConfig();
    const done = sessionId ? "checkout=done" : "portal=1";
    if (!found.ok) return back(done);
    const now = new Date();
    try {
      if (sessionId && /^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) {
        const session = await retrieveCheckout(found.config, sessionId);
        // Only a session this workspace started.
        if (session.workspaceId === ctx.workspaceId && session.subscription) {
          const change = subscriptionChange(session.subscription, found.config, now);
          if (change.kind === "subscription") await syncSubscription(ctx.workspaceId, change);
        }
      } else if (!sessionId && can(ctx.role, "billing.read")) {
        const sub = await repo.billing.get();
        if (sub?.stripeSubscriptionId) {
          const change = subscriptionChange(await retrieveSubscription(found.config, sub.stripeSubscriptionId), found.config, now);
          if (change.kind === "subscription") await syncSubscription(ctx.workspaceId, change);
        }
      }
    } catch (err) {
      console.error("[billing] return sync failed:", err instanceof Error ? err.name : "unknown");
    }
    return back(done);
  });
}
