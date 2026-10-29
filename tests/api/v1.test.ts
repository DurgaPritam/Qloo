import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as brandsRoute } from "@/app/api/v1/brands/matches/route";
import { GET as citiesRoute } from "@/app/api/v1/fanbases/cities/route";
import { GET as overlapRoute } from "@/app/api/v1/overlap/route";
import { GET as planRoute } from "@/app/api/v1/plans/[id]/route";
import { POST as createPlanRoute } from "@/app/api/v1/plans/route";
import { GET as venuesRoute } from "@/app/api/v1/venues/route";
import { ATTRIBUTION } from "@/lib/api/attribution";
import { getDb, type DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { apiKeys, apiUsage, workspaces } from "@/lib/db/schema";
import { unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { TIERS } from "@/lib/entitlements";

import { addUser } from "../support/db";

let db: DB;

async function workspaceWithKey(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  const repo = forWorkspace(db, { userId: user.id, workspaceId, role: "owner" });
  const { id, key } = await repo.api.createKey("Test");
  return { user, workspaceId, repo, keyId: id, key };
}
const get = (path: string, key?: string) => new Request(`http://localhost${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });

beforeAll(async () => {
  db = await getDb();
});
beforeEach(() => {
  vi.stubEnv("TAKEOVER_MOCK", "1");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("API keys", () => {
  it("are shown once, stored only as a SHA-256 hash with a short prefix, and stop working when revoked", async () => {
    const { repo, keyId, key } = await workspaceWithKey("keys@v1.test");
    expect(key).toMatch(/^tk_[A-Za-z0-9_-]{40,}$/);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId));
    expect(row.hash).toBe(createHash("sha256").update(key).digest("hex"));
    expect(row.prefix).toBe(key.slice(0, 9));
    expect(JSON.stringify(row)).not.toContain(key);
    const listed = await repo.api.keys();
    expect(JSON.stringify(listed)).not.toContain(key);
    expect(listed[0]).not.toHaveProperty("hash");

    expect((await overlapRoute(get("/api/v1/overlap?a=Phoebe%20Bridgers&b=PEN15", key))).status).toBe(200);
    await repo.api.revokeKey(keyId);
    const after = await overlapRoute(get("/api/v1/overlap?a=Phoebe%20Bridgers&b=PEN15", key));
    expect(after.status).toBe(401);
    expect((await overlapRoute(get("/api/v1/overlap?a=x&b=y", "tk_" + "a".repeat(43)))).status).toBe(401);
    expect((await overlapRoute(get("/api/v1/overlap?a=x&b=y"))).status).toBe(401);
  });

  it("are capped per plan tier, and only admins make them", async () => {
    const { repo, user, workspaceId } = await workspaceWithKey("cap@v1.test");
    for (let i = 1; i < TIERS.free.api.keys; i++) await repo.api.createKey(`k${i}`);
    await expect(repo.api.createKey("one too many")).rejects.toThrow(/allows 2 active keys/);
    const member = forWorkspace(db, { userId: user.id, workspaceId, role: "member" });
    await expect(member.api.createKey("x")).rejects.toThrow();
  });
});

describe("quotas", () => {
  it("count atomically and never past the quota", async () => {
    const { repo, keyId } = await workspaceWithKey("count@v1.test");
    const now = new Date("2026-10-29T10:00:00Z");
    const results = await Promise.all(Array.from({ length: 5 }, () => repo.api.count(keyId, "/overlap", "2026-10", 3, now)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    const usage = await repo.api.usage("2026-10");
    expect(usage.find((u) => u.endpoint === "*")?.count).toBe(3);
    expect(usage.find((u) => u.endpoint === "/overlap")?.count).toBe(3);
  });

  it("refuse a request once the monthly quota is used, with nothing run", async () => {
    const { key, keyId, workspaceId } = await workspaceWithKey("quota@v1.test");
    const month = new Date().toISOString().slice(0, 7);
    await db.insert(apiUsage).values({ workspaceId, keyId, month, endpoint: "*", count: TIERS.free.api.monthly });
    const res = await venuesRoute(get("/api/v1/venues?city=Austin", key));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.attribution).toEqual(ATTRIBUTION);
    expect(res.headers.get("X-Quota-Limit")).toBe(String(TIERS.free.api.monthly));
    const [total] = await db.select().from(apiUsage).where(and(eq(apiUsage.keyId, keyId), eq(apiUsage.endpoint, "*")));
    expect(total.count).toBe(TIERS.free.api.monthly);
  });

  it("follow the workspace's tier, and the per-minute rate limit applies per key", async () => {
    const { key, workspaceId } = await workspaceWithKey("rate@v1.test");
    await db.update(workspaces).set({ tier: "free" }).where(eq(workspaces.id, workspaceId));
    const statuses: number[] = [];
    for (let i = 0; i <= TIERS.free.api.perMinute; i++) statuses.push((await venuesRoute(get("/api/v1/venues?city=Austin", key))).status);
    expect(statuses.slice(0, TIERS.free.api.perMinute).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("every response carries Qloo's attribution and its evidence", () => {
  it("on success for each endpoint, and on errors", async () => {
    const { key } = await workspaceWithKey("attr@v1.test");
    const answers = await Promise.all([
      overlapRoute(get("/api/v1/overlap?a=Phoebe%20Bridgers&b=PEN15", key)),
      citiesRoute(get("/api/v1/fanbases/cities?q=John%20Mulaney", key)),
      venuesRoute(get("/api/v1/venues?city=Austin&kinds=music,comedy", key)),
      brandsRoute(get("/api/v1/brands/matches?q=Liquid%20Death", key)),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.attribution).toEqual(ATTRIBUTION);
      expect(body.evidence.requests.length).toBeGreaterThan(0);
      expect(body.meta.quota.limit).toBe(TIERS.free.api.monthly);
      expect(body.data.status).toBe("done");
    }
    for (const res of [await overlapRoute(get("/api/v1/overlap?a=x", key)), await overlapRoute(get("/api/v1/overlap?a=x&b=y"))]) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await res.json()).attribution).toEqual(ATTRIBUTION);
    }
  });
});

describe("plans", () => {
  it("are made in the background: 202 with a job id, then the plan in the workspace", async () => {
    const { key, repo } = await workspaceWithKey("plan@v1.test");
    const res = await createPlanRoute(new Request("http://localhost/api/v1/plans", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ query: "Phoebe Bridgers" }) }));
    expect(res.status).toBe(202);
    const { data } = await res.json();
    expect(data).toMatchObject({ status: "queued", poll: `/api/v1/plans/${data.planId}` });
    let body: { data: { status: string; plan?: { partner: unknown } }; attribution: unknown } | null = null;
    for (let i = 0; i < 60 && body?.data.status !== "done"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      body = await (await planRoute(get(`/api/v1/plans/${data.planId}`, key), { params: Promise.resolve({ id: data.planId }) })).json();
    }
    expect(body!.data.status).toBe("done");
    expect(body!.data.plan!.partner).toBeTruthy();
    expect(body!.attribution).toEqual(ATTRIBUTION);
    expect(await repo.plans.get(data.planId)).not.toBeNull();
  }, 30_000);
});

describe("the public API in production", () => {
  it("is off until TAKEOVER_PUBLIC_API=1", async () => {
    const { key } = await workspaceWithKey("prod@v1.test");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await venuesRoute(get("/api/v1/venues?city=Austin", key));
    expect(res.status).toBe(403);
    expect((await res.json()).attribution).toEqual(ATTRIBUTION);
  });
});

describe("the OpenAPI description", () => {
  it("lists every v1 endpoint, each backed by a route, and the attribution in every response schema", async () => {
    const { existsSync } = await import("node:fs");
    const { openApiSpec } = await import("@/lib/api/openapi");
    const spec = openApiSpec("https://takeover.test");
    expect(Object.keys(spec.paths).sort()).toEqual(["/brands/matches", "/fanbases/cities", "/overlap", "/plans", "/plans/{id}", "/venues"]);
    for (const p of Object.keys(spec.paths)) expect(existsSync(`app/api/v1${p.replace("{id}", "[id]")}/route.ts`), p).toBe(true);
    expect(spec.components.schemas.Envelope.required).toContain("attribution");
    expect(spec.components.schemas.Error.required).toContain("attribution");
  });
});
