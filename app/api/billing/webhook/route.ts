import { changeFor, stripeConfig, verifySignature, type StripeEvent } from "@/lib/billing/stripe";
import { applyBillingEvent } from "@/lib/workspace/tier";

/**
 * Stripe webhooks: checkout.session.completed, customer.subscription.created/updated/deleted,
 * invoice.payment_failed and invoice.paid. The signature is checked against the raw body first;
 * each event id is applied once (lib/db/unscoped.ts unscopedApplyBilling).
 */
export async function POST(req: Request): Promise<Response> {
  const found = stripeConfig();
  if (!found.ok || !found.config.webhookSecret) return Response.json({ error: "Billing isn't set up." }, { status: 503 });
  const payload = await req.text();
  if (!verifySignature(payload, req.headers.get("stripe-signature"), found.config.webhookSecret)) return Response.json({ error: "Bad signature." }, { status: 400 });
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return Response.json({ error: "Bad payload." }, { status: 400 });
  }
  if (typeof event?.id !== "string" || typeof event.type !== "string" || typeof event.created !== "number") return Response.json({ error: "Bad payload." }, { status: 400 });
  try {
    const outcome = await applyBillingEvent(event, changeFor(event, found.config));
    return Response.json({ received: true, status: outcome.status });
  } catch (err) {
    // 500 so Stripe retries; nothing was recorded for this event.
    console.error("[billing] webhook failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Try again." }, { status: 500 });
  }
}
