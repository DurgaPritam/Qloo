import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createKey } from "@/app/api/workspace/api-keys/route";
import { POST as invite } from "@/app/api/workspace/invitations/route";
import { POST as addAct } from "@/app/api/workspace/rosters/[id]/acts/route";
import { GET as listRosters, POST as createRoster } from "@/app/api/workspace/rosters/route";
import { DELETE as unwatch } from "@/app/api/workspace/watch/[id]/route";
import { GET as watchGet, POST as watchPost } from "@/app/api/workspace/watch/route";
import { getDb, type DB } from "@/lib/db";
import { forWorkspace, type WorkspaceRepo } from "@/lib/db/scoped";
import { workspaces } from "@/lib/db/schema";
import { unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { FEATURES, featuresOf, has, limitsOf, nextTierFor, tierFor, TIER_NAMES, TIERS, upgradeFor, type Feature } from "@/lib/entitlements";
import { featureAccess, planSaving } from "@/lib/workspace/gate";

import { addUser } from "../support/db";

/** The workspace the mocked session acts in; set per test. */
let current: {
  user: { id: string; email: string | null; name: string | null };
  ctx: { userId: string; workspaceId: string; role: "owner" };
  repo: WorkspaceRepo;
  memberships: { workspaceId: string; name: string }[];
} | null = null;
vi.mock("@/lib/workspace/session", async (original) => ({ ...(await original<typeof import("@/lib/workspace/session")>()), currentWorkspace: async () => current }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

let db: DB;

async function signIn(email: string, tier: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  await setTier(workspaceId, tier);
  const ctx = { userId: user.id, workspaceId, role: "owner" as const };
  current = { user: { id: user.id, email: user.email, name: null }, ctx, repo: forWorkspace(db, ctx), memberships: [{ workspaceId, name: "Test" }] };
  return current;
}
const setTier = (workspaceId: string, tier: string) => db.update(workspaces).set({ tier }).where(eq(workspaces.id, workspaceId));
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  db = await getDb();
});
beforeEach(() => {
  vi.stubEnv("TAKEOVER_MOCK", "1");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  current = null;
});

describe("the tier map", () => {
  it("gives every feature to exactly one tier, and each tier everything below it", () => {
    for (const f of Object.keys(FEATURES) as Feature[])
      expect(
        TIER_NAMES.filter((t) => TIERS[t].adds.includes(f)),
        f,
      ).toHaveLength(1);
    for (let i = 1; i < TIER_NAMES.length; i++) for (const f of featuresOf(TIER_NAMES[i - 1])) expect(has(TIER_NAMES[i], f)).toBe(true);
    expect(featuresOf("free")).toEqual([]);
    expect(featuresOf("nonsense")).toEqual([]); // an unknown tier is Free
    expect(tierFor("campaign.briefs")).toBe("pro");
    expect(tierFor("white.label")).toBe("enterprise");
    expect(upgradeFor("rosters")).toMatchObject({ tier: "team", selfServe: true });
    expect(upgradeFor("api")).toMatchObject({ tier: "enterprise", selfServe: false });
  });

  it("raises limits tier by tier; Team seats are the seats bought", () => {
    expect(nextTierFor("free", "plansPerMonth")).toBe("pro");
    expect(nextTierFor("pro", "rosterActs")).toBe("team");
    expect(nextTierFor("enterprise", "qlooMonthly")).toBeNull();
    expect(limitsOf("team", { seatsBought: 8 }).seats).toBe(8);
    expect(limitsOf("team", { seatsBought: 2 }).seats).toBe(2);
    expect(limitsOf("team").seats).toBe(TIERS.team.limits.seats);
    expect(limitsOf("pro", { seatsBought: 8 }).seats).toBe(TIERS.pro.limits.seats);
  });
});

/**
 * Every API route either checks an entitlement itself, hands the check to a named module, or is
 * listed here with the reason it needs none. A new feature route fails this test until it does one.
 */
const GATES = /\b(inFeature|needFeature|featureAccess|planSaving|visitorLimits|v1)\(|\bhas\(\s*[\w.]+\s*,\s*"/;
const DELEGATED: Record<string, string> = {
  "app/api/jobs/pipeline-reminders/route.ts": "lib/pipeline/reminders.ts",
  "app/api/jobs/roster-refresh/route.ts": "lib/roster/jobs.ts",
  "app/api/jobs/watch-refresh/route.ts": "lib/watch/jobs.ts",
  "app/api/jobs/watch-tick/route.ts": "lib/watch/jobs.ts",
};
const UNGATED: Record<string, string> = {
  "app/api/account/route.ts": "who is signed in and switching workspace, on every tier",
  "app/api/billing/webhook/route.ts": "Stripe webhooks: signature-verified, they set the tier",
  "app/api/workspace/billing/checkout/route.ts": "buying a plan is open to every tier (owners only)",
  "app/api/workspace/billing/contact/route.ts": "the Enterprise contact form, on every tier",
  "app/api/workspace/billing/return/route.ts": "reads the workspace's own subscription back from Stripe after Checkout or the portal",
  "app/api/workspace/billing/portal/route.ts": "managing or cancelling a plan is always allowed (owners only)",
  "app/api/auth/[...nextauth]/route.ts": "sign-in",
  "app/api/daily/route.ts": "Daily game: Free",
  "app/api/dev/tier/route.ts": "e2e only; refuses outside tests",
  "app/api/dev/watch-seed/route.ts": "e2e only; refuses outside tests",
  "app/api/digest/unsubscribe/route.ts": "unsubscribing is always allowed",
  "app/api/health/route.ts": "health check",
  "app/api/jobs/plan-create/route.ts": "queued only by POST /api/v1/plans, after its tier check",
  "app/api/llm-only/route.ts": "single plans: Free",
  "app/api/suggest/route.ts": "search suggestions: Free",
  "app/api/tools/audience/route.ts": "today's tools: Free",
  "app/api/tools/brand/route.ts": "today's tools: Free",
  "app/api/tools/cities/route.ts": "today's tools: Free",
  "app/api/tools/lineup/resolve/route.ts": "resolving names for the optimizer; the pool size is limited when it is scored",
  "app/api/tools/lineup/save/route.ts": "saves a poster of a bill already scored within the tier's pool",
  "app/api/tools/overlap/route.ts": "today's tools: Free",
  "app/api/tools/tour/suggest/route.ts": "Tour planner: one stop's venue, support act or sponsors on click, Free (stops are already limited when the route is optimized)",
  "app/api/tour/planner/city/route.ts": "Tour planner: matching a typed city to the city list, no Qloo call",
  "app/api/tour/planner/edit/route.ts": "Tour planner AI edit: Free, rate-limited like llm-only and counted against the daily token budget",
  "app/api/tools/venue/route.ts": "today's tools: Free",
  "app/api/v1/openapi.json/route.ts": "the public API description",
  "app/api/votes/route.ts": "city votes on shared plans: anyone",
  "app/api/workspace/datasets/for-plan/route.ts": "read only: your data already stored (a downgrade keeps it readable)",
  "app/api/workspace/inbox/route.ts": "your own notifications: read and mark read",
  "app/api/workspace/members/route.ts": "managing existing members (role, remove, leave) stays open so a downgraded workspace can get under its seats",
  "app/api/workspace/onboarding/route.ts": "the getting-started checklist: reads counts and stores its dismissal, on every tier",
  "app/api/workspace/search/route.ts": "read only: searching what the workspace stored",
  "app/api/workspace/settings/route.ts": "workspace name, time zone, currency: every tier",
  "app/api/workspace/watch/[id]/route.ts": "DELETE only: removing data is always allowed",
};

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routes(p) : name === "route.ts" ? [p] : [];
  });
}

describe("every feature route checks an entitlement", () => {
  const all = routes("app/api").sort();

  it("in the route, in the module it names, or on the reasoned ungated list", () => {
    const missing = all.filter((f) => {
      if (f in UNGATED) return false;
      if (f in DELEGATED) return !GATES.test(readFileSync(DELEGATED[f], "utf8"));
      return !GATES.test(readFileSync(f, "utf8"));
    });
    expect(missing, "routes with no entitlement check: gate them in lib/workspace/gate or list them with a reason").toEqual([]);
  });

  it("has no stale entries, and no route both gated and listed as ungated", () => {
    for (const f of [...Object.keys(UNGATED), ...Object.keys(DELEGATED)]) expect(all, f).toContain(f);
    for (const f of Object.keys(UNGATED)) expect(GATES.test(readFileSync(f, "utf8")) && !/\bv1\(/.test(readFileSync(f, "utf8")), `${f} is gated; take it off UNGATED`).toBe(false);
  });

  it("keeps tier logic in lib/entitlements: nothing else compares tier names", () => {
    const files = [...routes("app"), ...readdirSync("lib", { recursive: true }).map((f) => join("lib", String(f)))].filter((f) => /\.tsx?$/.test(f));
    const offenders = files.filter(
      (f) => !f.startsWith("lib/entitlements") && /tier\s*[!=]==\s*"(free|pro|team|enterprise)"|"(free|pro|team|enterprise)"\s*[!=]==\s*\w*tier/i.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("a downgrade keeps data read-only", () => {
  it("reads and deletes still work; writes answer 402 with the tier that unlocks them", async () => {
    const { repo, ctx } = await signIn("down@ent.test", "enterprise");
    const created = await (await createRoster(post({ name: "Fall" }))).json();
    expect(created.id).toBeTruthy();
    const watched = await (await watchPost(post({ kind: "fanbase", query: "Phoebe Bridgers" }))).json();
    expect(watched.error).toBeUndefined();

    await setTier(ctx.workspaceId, "free");

    // Reads: everything stored is still there.
    const { rosters } = await (await listRosters()).json();
    expect(rosters.map((r: { id: string }) => r.id)).toContain(created.id);
    const view = await (await watchGet()).json();
    expect(view.items.length).toBe(1);
    expect((await featureAccess(repo, "rosters")).allowed).toBe(false);

    // Writes: 402, naming the tier and what it adds, and nothing changes.
    const refused = await createRoster(post({ name: "Winter" }));
    expect(refused.status).toBe(402);
    const body = await refused.json();
    expect(body).toMatchObject({ code: "upgrade_required", upgrade: { tier: "team", selfServe: true } });
    expect(body.upgrade.unlocks).toContain(FEATURES.rosters);
    expect(body.error).toMatch(/Plans & billing/);
    expect((await watchPost(post({ kind: "fanbase", query: "PEN15" }))).status).toBe(402);
    expect((await repo.rosters.list()).length).toBe(1);

    // Deleting is always allowed.
    const del = await unwatch(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: view.items[0].id }) });
    expect(del.status).toBe(200);
    expect((await repo.watch.items()).length).toBe(0);
  });

  it("stops saving plans to the workspace below Pro, with the reason and the upgrade", async () => {
    const { repo, ctx } = await signIn("plans@ent.test", "pro");
    expect(await planSaving(repo)).toEqual({ ok: true });
    await setTier(ctx.workspaceId, "free");
    const saving = await planSaving(repo);
    expect(saving).toMatchObject({ ok: false, upgrade: { tier: "pro" } });
  });
});

describe("limits", () => {
  it("cap API keys at the tier's number", async () => {
    await signIn("keys@ent.test", "enterprise");
    for (let i = 0; i < TIERS.enterprise.limits.api.keys; i++) expect((await createKey(post({ name: `k${i}` }))).status).toBe(200);
    const res = await createKey(post({ name: "one too many" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(new RegExp(`allows ${TIERS.enterprise.limits.api.keys} active keys`));
  });

  it("cap a roster's acts, offering the tier that raises the cap", async () => {
    const { repo, ctx } = await signIn("acts@ent.test", "team");
    const id = await repo.rosters.create("Big");
    const many = Array.from({ length: TIERS.team.limits.rosterActs }, (_, i) => ({ entity: { id: `x${i}`, name: `X${i}`, category: "artist" as const, popularity: 0.5 } }));
    await repo.rosters.addActs(id, many, "csv");
    const res = await addAct(post({ query: "Phoebe Bridgers" }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(402);
    expect((await res.json()).upgrade).toMatchObject({ tier: "enterprise", feature: null });
    expect((await repo.rosters.acts(id)).length).toBe(TIERS.team.limits.rosterActs);
    expect(ctx.workspaceId).toBeTruthy();
  });

  it("cap members at the seats: Team counts the seats bought", async () => {
    const { ctx } = await signIn("seats@ent.test", "team");
    for (let i = 1; i < TIERS.team.limits.seats!; i++) expect((await invite(post({ email: `s${i}@seat.test`, role: "member" }))).status).toBe(200);
    expect((await invite(post({ email: "extra@seat.test", role: "member" }))).status).toBe(402);
    await db.update(workspaces).set({ seats: 5 }).where(eq(workspaces.id, ctx.workspaceId));
    expect((await invite(post({ email: "extra@seat.test", role: "member" }))).status).toBe(200);
  });
});
