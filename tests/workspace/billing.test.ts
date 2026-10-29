import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as webhook } from "@/app/api/billing/webhook/route";
import { POST as checkout } from "@/app/api/workspace/billing/checkout/route";
import { POST as contact } from "@/app/api/workspace/billing/contact/route";
import { POST as portal } from "@/app/api/workspace/billing/portal/route";
import { POST as createRoster, GET as listRosters } from "@/app/api/workspace/rosters/route";
import { signPayload, stripeConfig, verifySignature } from "@/lib/billing/stripe";
import { getDb, type DB } from "@/lib/db";
import { forWorkspace, type WorkspaceRepo } from "@/lib/db/scoped";
import { activityLog, billingEvents, subscriptions, workspaces } from "@/lib/db/schema";
import { unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { readOutbox } from "@/lib/email/mailer";
import { TIERS } from "@/lib/entitlements";
import { tierAllowance } from "@/lib/workspace/tier";

import { addUser } from "../support/db";

type Role = "owner" | "admin" | "member" | "viewer";
let current: {
  user: { id: string; email: string | null; name: string | null };
  ctx: { userId: string; workspaceId: string; role: Role };
  repo: WorkspaceRepo;
  memberships: { workspaceId: string; name: string }[];
} | null = null;
vi.mock("@/lib/workspace/session", async (original) => ({ ...(await original<typeof import("@/lib/workspace/session")>()), currentWorkspace: async () => current }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

const SECRET = "whsec_test_secret_for_unit_tests";
const PRICES = {
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
  STRIPE_PRICE_PRO_ANNUAL: "price_pro_y",
  STRIPE_PRICE_TEAM_MONTHLY: "price_team_m",
  STRIPE_PRICE_TEAM_ANNUAL: "price_team_y",
};
let db: DB;
let seq = 0;

async function owner(email: string, tier = "free", role: Role = "owner") {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  await db.update(workspaces).set({ tier }).where(eq(workspaces.id, workspaceId));
  const ctx = { userId: user.id, workspaceId, role };
  current = { user: { id: user.id, email: user.email, name: null }, ctx, repo: forWorkspace(db, ctx), memberships: [{ workspaceId, name: "Test" }] };
  return current;
}
const tierOf = async (workspaceId: string) => (await db.select({ tier: workspaces.tier, seats: workspaces.seats }).from(workspaces).where(eq(workspaces.id, workspaceId)))[0];

/** A Stripe event, signed as Stripe would sign it. */
function event(type: string, object: Record<string, unknown>, opts: { id?: string; created?: number } = {}) {
  const body = JSON.stringify({
    id: opts.id ?? `evt_${++seq}_${Math.random().toString(36).slice(2)}`,
    type,
    created: opts.created ?? Math.floor(Date.now() / 1000) + seq,
    data: { object },
  });
  return {
    body,
    send: (sig = signPayload(body, SECRET)) => webhook(new Request("http://localhost/api/billing/webhook", { method: "POST", headers: { "stripe-signature": sig }, body })),
  };
}
const sub = (workspaceId: string, customer: string, price: string, extra: Record<string, unknown> = {}) => ({
  id: `sub_${customer}`,
  customer,
  status: "active",
  metadata: { workspace_id: workspaceId },
  cancel_at_period_end: false,
  items: { data: [{ price: { id: price }, quantity: 1, current_period_end: 1_800_000_000 }] },
  ...extra,
});
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  db = await getDb();
});
beforeEach(() => {
  vi.stubEnv("TAKEOVER_MOCK", "1");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  for (const [k, v] of Object.entries(PRICES)) vi.stubEnv(k, v);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  current = null;
});

describe("Stripe setup", () => {
  it("accepts only test-mode keys, and reads the price ids per tier and interval", () => {
    expect(stripeConfig({})).toMatchObject({ ok: false });
    expect(stripeConfig({ STRIPE_SECRET_KEY: "sk_live_x" })).toEqual({ ok: false, reason: "Billing accepts only Stripe test-mode keys for now." });
    const found = stripeConfig({ STRIPE_SECRET_KEY: "sk_test_x", ...PRICES });
    expect(found.ok && found.config.prices).toEqual({ pro: { month: "price_pro_m", year: "price_pro_y" }, team: { month: "price_team_m", year: "price_team_y" } });
  });

  it("verifies webhook signatures: right secret, fresh timestamp, constant-time compare", () => {
    const body = '{"id":"evt_1"}';
    const now = 1_800_000_000;
    expect(verifySignature(body, signPayload(body, SECRET, now), SECRET, now)).toBe(true);
    expect(verifySignature(body, `${signPayload(body, "whsec_other", now)},v1=${"0".repeat(64)}`, SECRET, now)).toBe(false);
    expect(verifySignature(body + " ", signPayload(body, SECRET, now), SECRET, now)).toBe(false);
    expect(verifySignature(body, signPayload(body, SECRET, now - 301), SECRET, now)).toBe(false);
    expect(verifySignature(body, null, SECRET, now)).toBe(false);
    // Stripe sends several v1 signatures while a secret is being rolled.
    expect(verifySignature(body, `t=${now},v1=${"0".repeat(64)},${signPayload(body, SECRET, now).split(",")[1]}`, SECRET, now)).toBe(true);
  });
});

describe("webhooks", () => {
  it("refuse a bad signature and record nothing", async () => {
    const { ctx } = await owner("sig@bill.test");
    const e = event("customer.subscription.created", sub(ctx.workspaceId, "cus_sig", "price_pro_m"));
    expect((await e.send("t=1,v1=bad")).status).toBe(400);
    expect((await tierOf(ctx.workspaceId)).tier).toBe("free");
    expect(await db.select().from(billingEvents).where(eq(billingEvents.type, "never"))).toEqual([]);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await e.send()).status).toBe(503);
  });

  it("upgrade: checkout links the customer, the subscription sets the tier, Team takes its seats", async () => {
    const { ctx } = await owner("up@bill.test");
    expect(await tierAllowance(ctx.workspaceId)).toBe(TIERS.free.limits.qlooMonthly);
    expect((await event("checkout.session.completed", { mode: "subscription", customer: "cus_up", client_reference_id: ctx.workspaceId }).send()).status).toBe(200);
    expect((await event("customer.subscription.created", sub(ctx.workspaceId, "cus_up", "price_pro_m")).send()).status).toBe(200);
    expect(await tierOf(ctx.workspaceId)).toEqual({ tier: "pro", seats: null });
    // The tier cache is dropped on change, so the new Qloo allowance applies at once.
    expect(await tierAllowance(ctx.workspaceId)).toBe(TIERS.pro.limits.qlooMonthly);

    const team = sub(ctx.workspaceId, "cus_up", "price_team_y", { items: { data: [{ price: { id: "price_team_y" }, quantity: 5, current_period_end: 1_800_000_000 }] } });
    await event("customer.subscription.updated", team).send();
    expect(await tierOf(ctx.workspaceId)).toEqual({ tier: "team", seats: 5 });
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, ctx.workspaceId));
    expect(row).toMatchObject({ stripeCustomerId: "cus_up", tier: "team", interval: "year", seats: 5, status: "active" });
    const log = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.workspaceId, ctx.workspaceId), eq(activityLog.action, "billing.tier")));
    expect(log.map((l) => l.detail?.to)).toEqual(["pro", "team"]);
  });

  it("downgrade: a deleted subscription means Free, and the workspace's data stays readable, not writable", async () => {
    const { ctx } = await owner("down@bill.test");
    await event("customer.subscription.created", sub(ctx.workspaceId, "cus_down", "price_team_m")).send();
    expect((await tierOf(ctx.workspaceId)).tier).toBe("team");
    const { id } = await (await createRoster(post({ name: "Kept" }))).json();

    await event("customer.subscription.deleted", sub(ctx.workspaceId, "cus_down", "price_team_m", { status: "canceled" })).send();
    expect(await tierOf(ctx.workspaceId)).toEqual({ tier: "free", seats: null });
    const { rosters } = await (await listRosters()).json();
    expect(rosters.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await createRoster(post({ name: "New" }))).status).toBe(402);
  });

  it("failed payment: flagged while Stripe retries (the tier holds), Free once unpaid, cleared when paid", async () => {
    const { ctx } = await owner("fail@bill.test");
    await event("customer.subscription.created", sub(ctx.workspaceId, "cus_fail", "price_pro_m")).send();
    await event("invoice.payment_failed", { customer: "cus_fail" }).send();
    await event("customer.subscription.updated", sub(ctx.workspaceId, "cus_fail", "price_pro_m", { status: "past_due" })).send();
    expect((await tierOf(ctx.workspaceId)).tier).toBe("pro");
    expect((await current!.repo.billing.get())?.paymentFailedAt).toBeInstanceOf(Date);

    await event("customer.subscription.updated", sub(ctx.workspaceId, "cus_fail", "price_pro_m", { status: "unpaid" })).send();
    expect((await tierOf(ctx.workspaceId)).tier).toBe("free");

    await event("invoice.paid", { customer: "cus_fail" }).send();
    await event("customer.subscription.updated", sub(ctx.workspaceId, "cus_fail", "price_pro_m", { status: "active" })).send();
    expect((await tierOf(ctx.workspaceId)).tier).toBe("pro");
    expect((await current!.repo.billing.get())?.paymentFailedAt).toBeNull();
  });

  it("are idempotent: a redelivered event changes nothing, and an older event never overwrites a newer one", async () => {
    const { ctx } = await owner("idem@bill.test");
    const created = Math.floor(Date.now() / 1000);
    const first = event("customer.subscription.created", sub(ctx.workspaceId, "cus_idem", "price_pro_m"), { id: "evt_idem_1", created });
    expect(await (await first.send()).json()).toMatchObject({ status: "applied" });
    expect(await (await first.send()).json()).toMatchObject({ status: "duplicate" });
    expect(await db.select().from(billingEvents).where(eq(billingEvents.id, "evt_idem_1"))).toHaveLength(1);

    await event("customer.subscription.updated", sub(ctx.workspaceId, "cus_idem", "price_team_m"), { created: created + 60 }).send();
    const stale = await event("customer.subscription.updated", sub(ctx.workspaceId, "cus_idem", "price_pro_m"), { created: created + 30 }).send();
    expect(await stale.json()).toMatchObject({ status: "ignored" });
    expect((await tierOf(ctx.workspaceId)).tier).toBe("team");
  });

  it("never change a tier assigned by hand (Enterprise)", async () => {
    const { ctx } = await owner("ent@bill.test", "enterprise");
    await event("customer.subscription.deleted", sub(ctx.workspaceId, "cus_ent", "price_pro_m", { status: "canceled" })).send();
    expect((await tierOf(ctx.workspaceId)).tier).toBe("enterprise");
  });
});

describe("checkout and the portal", () => {
  function stripe(answer: (url: string, body: string) => unknown = () => ({ url: "https://checkout.stripe.test/s" })) {
    const calls: { url: string; body: string; auth: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body ?? ""), auth: String((init.headers as Record<string, string>).authorization) });
        return Response.json(answer(url, String(init.body ?? "")));
      }),
    );
    return calls;
  }

  it("opens Checkout for the workspace, per seat for Team, with the workspace id for the webhooks", async () => {
    const { ctx } = await owner("buy@bill.test");
    const calls = stripe();
    const res = await checkout(post({ tier: "team", interval: "year", seats: 4 }));
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    const form = new URLSearchParams(calls[0].body);
    expect(calls[0].url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(calls[0].auth).toBe("Bearer sk_test_unit");
    expect(Object.fromEntries(form)).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": "price_team_y",
      "line_items[0][quantity]": "4",
      client_reference_id: ctx.workspaceId,
      "subscription_data[metadata][workspace_id]": ctx.workspaceId,
    });
    expect((await checkout(post({ tier: "enterprise", interval: "month" }))).status).toBe(400);
    // Never fewer seats than the workspace already uses; none asked means exactly those.
    const fewer = await checkout(post({ tier: "team", interval: "month", seats: 0 }));
    expect(fewer.status).toBe(400);
    expect((await fewer.json()).error).toMatch(/already uses 1 seat;/);
    await checkout(post({ tier: "team", interval: "month" }));
    expect(new URLSearchParams(calls.at(-1)!.body).get("line_items[0][quantity]")).toBe("1");
  });

  it("sends a paying workspace to the portal instead of a second subscription; only owners buy", async () => {
    const { ctx } = await owner("portal@bill.test");
    await event("customer.subscription.created", sub(ctx.workspaceId, "cus_portal", "price_pro_m")).send();
    const calls = stripe(() => ({ url: "https://billing.stripe.test/p" }));
    expect(await (await checkout(post({ tier: "team", interval: "month" }))).json()).toMatchObject({ url: "https://billing.stripe.test/p", portal: true });
    expect(calls[0].url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect((await portal(post({}))).status).toBe(200);

    current = { ...current!, ctx: { ...current!.ctx, role: "admin" }, repo: forWorkspace(db, { ...current!.ctx, role: "admin" }) };
    expect((await checkout(post({ tier: "team", interval: "month" }))).status).toBe(403);
    expect((await portal(post({}))).status).toBe(403);
  });

  it("refuses when Stripe isn't set up, or with a live key", async () => {
    await owner("nostripe@bill.test");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect((await checkout(post({ tier: "pro", interval: "month" }))).status).toBe(503);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_nope");
    const res = await checkout(post({ tier: "pro", interval: "month" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/test-mode/);
  });
});

describe("Enterprise contact", () => {
  it("emails Takeover on the user's click, replying to them", async () => {
    await owner("cont@bill.test");
    vi.stubEnv("CONTACT_EMAIL", "sales@takeover.test");
    expect((await contact(post({ name: "", message: "" }))).status).toBe(400);
    expect((await contact(post({ name: "Cora", company: "North Star", message: "We run 40 shows a year." }))).status).toBe(200);
    const [mail] = readOutbox("sales@takeover.test");
    expect(mail.subject).toBe("Enterprise enquiry from North Star");
    expect(mail.headers?.["Reply-To"]).toBe("cont@bill.test");
    expect(mail.text).toContain("We run 40 shows a year.");
  });
});
