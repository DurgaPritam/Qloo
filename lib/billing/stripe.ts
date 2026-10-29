import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { isTier, SELF_SERVE, type TierName } from "@/lib/entitlements";

/**
 * Stripe over its REST API (no SDK dependency). Test mode only: a live key is refused, so no real
 * card can be charged until that is decided. Keys stay on the server and are never logged.
 */
export type Interval = "month" | "year";
export const INTERVALS: Interval[] = ["month", "year"];

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string | null;
  /** Price ids by tier and interval, from STRIPE_PRICE_<TIER>_<MONTHLY|ANNUAL>. */
  prices: Partial<Record<TierName, Partial<Record<Interval, string>>>>;
}

type Env = Record<string, string | undefined>;

export const NOT_SET_UP = "Billing isn't set up yet: the plans can't be bought here for now.";

export function stripeConfig(env: Env = process.env): { ok: true; config: StripeConfig } | { ok: false; reason: string } {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return { ok: false, reason: NOT_SET_UP };
  if (!/^(sk|rk)_test_/.test(secretKey)) return { ok: false, reason: "Billing accepts only Stripe test-mode keys for now." };
  const prices: StripeConfig["prices"] = {};
  for (const tier of SELF_SERVE) {
    const month = env[`STRIPE_PRICE_${tier.toUpperCase()}_MONTHLY`]?.trim();
    const year = env[`STRIPE_PRICE_${tier.toUpperCase()}_ANNUAL`]?.trim();
    prices[tier] = { ...(month ? { month } : {}), ...(year ? { year } : {}) };
  }
  return { ok: true, config: { secretKey, webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null, prices } };
}

/** The tier and interval a price id buys, or null for a price Takeover doesn't sell. */
export function tierForPrice(config: StripeConfig, priceId: string | null | undefined): { tier: TierName; interval: Interval } | null {
  if (!priceId) return null;
  for (const [tier, byInterval] of Object.entries(config.prices)) {
    for (const interval of INTERVALS) if (byInterval?.[interval] === priceId && isTier(tier)) return { tier, interval };
  }
  return null;
}

export class StripeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

export interface StripeDeps {
  fetch?: typeof fetch;
}

/** Stripe's form encoding: nested keys as a[b][c]. */
export function formEncode(params: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(params).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) return [];
    if (typeof v === "object") return formEncode(v as Record<string, unknown>, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });
}

async function call<T>(config: StripeConfig, method: "GET" | "POST", path: string, params: Record<string, unknown> = {}, deps: StripeDeps = {}): Promise<T> {
  const body = formEncode(params).join("&");
  const url = `https://api.stripe.com/v1${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await (deps.fetch ?? fetch)(url, {
    method,
    headers: { authorization: `Bearer ${config.secretKey}`, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  // Stripe's message, never the request (which carries the key in its headers).
  if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe answered ${res.status}`, res.status);
  return json;
}

export interface CheckoutInput {
  workspaceId: string;
  customerId: string | null;
  email: string | null;
  tier: TierName;
  interval: Interval;
  /** The subscription's quantity: seats for a per-seat tier, else 1. */
  quantity: number;
  origin: string;
}

/** A Checkout session for a subscription; the workspace id rides along so webhooks can find it. */
export async function createCheckout(config: StripeConfig, input: CheckoutInput, deps?: StripeDeps): Promise<string> {
  const price = config.prices[input.tier]?.[input.interval];
  if (!price) throw new StripeError("That plan has no price set up yet.", 400);
  const back = `${input.origin}/workspace/settings/billing`;
  const session = await call<{ url: string }>(
    config,
    "POST",
    "/checkout/sessions",
    {
      mode: "subscription",
      line_items: { 0: { price, quantity: input.quantity } },
      client_reference_id: input.workspaceId,
      ...(input.customerId ? { customer: input.customerId } : input.email ? { customer_email: input.email } : {}),
      metadata: { workspace_id: input.workspaceId },
      subscription_data: { metadata: { workspace_id: input.workspaceId } },
      success_url: `${back}?checkout=done`,
      cancel_url: `${back}?checkout=cancelled`,
    },
    deps,
  );
  return session.url;
}

/** The Customer Portal: change plan or seats, update the card, see invoices, cancel. */
export async function createPortal(config: StripeConfig, customerId: string, returnUrl: string, deps?: StripeDeps): Promise<string> {
  return (await call<{ url: string }>(config, "POST", "/billing_portal/sessions", { customer: customerId, return_url: returnUrl }, deps)).url;
}

export interface PriceView {
  tier: TierName;
  interval: Interval;
  /** In the currency's minor unit, as Stripe stores it; null for a price without a fixed amount. */
  unitAmount: number | null;
  currency: string;
}

const priceCache = new Map<string, { at: number; view: PriceView | null }>();

/** The configured prices as Stripe has them (cached ten minutes); a price Stripe can't find is left out. */
export async function priceViews(config: StripeConfig, deps?: StripeDeps & { now?: number }): Promise<PriceView[]> {
  const now = deps?.now ?? Date.now();
  const out: PriceView[] = [];
  for (const [tier, byInterval] of Object.entries(config.prices)) {
    for (const interval of INTERVALS) {
      const id = byInterval?.[interval];
      if (!id || !isTier(tier)) continue;
      const hit = priceCache.get(id);
      let view = hit && now - hit.at < 600_000 ? hit.view : undefined;
      if (view === undefined) {
        try {
          const p = await call<{ unit_amount: number | null; currency: string }>(config, "GET", `/prices/${encodeURIComponent(id)}`, {}, deps);
          view = { tier, interval, unitAmount: p.unit_amount, currency: p.currency };
        } catch {
          view = null;
        }
        priceCache.set(id, { at: now, view });
      }
      if (view) out.push(view);
    }
  }
  return out;
}

export interface InvoiceView {
  id: string;
  created: Date;
  amount: number;
  currency: string;
  status: string;
  pdf: string | null;
  lines: string;
}

/** The customer's latest invoices, as Stripe has them. */
export async function invoiceViews(config: StripeConfig, customerId: string, deps?: StripeDeps): Promise<InvoiceView[]> {
  type Raw = { id: string; created: number; total: number; currency: string; status: string; invoice_pdf: string | null; lines?: { data?: { description?: string | null }[] } };
  const list = await call<{ data: Raw[] }>(config, "GET", "/invoices", { customer: customerId, limit: 6 }, deps);
  return list.data.map((i) => ({
    id: i.id,
    created: new Date(i.created * 1000),
    amount: i.total,
    currency: i.currency,
    status: i.status,
    pdf: i.invoice_pdf,
    lines: i.lines?.data?.[0]?.description ?? "",
  }));
}

/* ---------- Webhooks ---------- */

/**
 * Checks a Stripe-Signature header (t=…,v1=…): an HMAC-SHA256 of "t.payload" with the endpoint's
 * secret, within five minutes, compared in constant time.
 */
export function verifySignature(payload: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return sigs.some((s) => {
    const given = Buffer.from(s ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Signs a payload as Stripe would (tests and local webhook checks). */
export function signPayload(payload: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

/** What an event changes, worked out without the database (lib/db/unscoped.ts applies it). */
export type BillingChange =
  | { kind: "link"; workspaceId: string | null; customerId: string }
  | {
      kind: "subscription";
      workspaceId: string | null;
      customerId: string;
      subscriptionId: string;
      tier: TierName | null;
      interval: Interval | null;
      status: string;
      seats: number | null;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
      eventAt: Date;
    }
  | { kind: "payment_failed"; customerId: string; at: Date }
  | { kind: "payment_ok"; customerId: string }
  | { kind: "ignore" };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const idOf = (v: unknown): string | null => str(v) ?? (v && typeof v === "object" ? str((v as { id?: unknown }).id) : null);
const meta = (o: Record<string, unknown>) => str((o.metadata as Record<string, unknown> | undefined)?.workspace_id);

export function changeFor(event: StripeEvent, config: StripeConfig): BillingChange {
  const o = event.data?.object ?? {};
  const customerId = idOf(o.customer);
  switch (event.type) {
    case "checkout.session.completed":
      return o.mode === "subscription" && customerId ? { kind: "link", workspaceId: str(o.client_reference_id) ?? meta(o), customerId } : { kind: "ignore" };
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscriptionId = str(o.id);
      if (!customerId || !subscriptionId) return { kind: "ignore" };
      const item = ((o.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0] ?? {};
      const bought = tierForPrice(config, idOf(item.price));
      // Newer API versions keep the period on the item; older ones on the subscription.
      const end = Number(item.current_period_end ?? o.current_period_end);
      return {
        kind: "subscription",
        workspaceId: meta(o),
        customerId,
        subscriptionId,
        tier: bought?.tier ?? null,
        interval: bought?.interval ?? null,
        status: event.type === "customer.subscription.deleted" ? "canceled" : (str(o.status) ?? "incomplete"),
        seats: typeof item.quantity === "number" ? item.quantity : null,
        currentPeriodEnd: Number.isFinite(end) && end > 0 ? new Date(end * 1000) : null,
        cancelAtPeriodEnd: o.cancel_at_period_end === true,
        eventAt: new Date(event.created * 1000),
      };
    }
    case "invoice.payment_failed":
      return customerId ? { kind: "payment_failed", customerId, at: new Date(event.created * 1000) } : { kind: "ignore" };
    case "invoice.paid":
      return customerId ? { kind: "payment_ok", customerId } : { kind: "ignore" };
    default:
      return { kind: "ignore" };
  }
}
