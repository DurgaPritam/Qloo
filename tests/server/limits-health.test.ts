import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";
import { getHealth } from "@/lib/server/health";
import { LIMITS, MemoryLimiter, visitorId } from "@/lib/server/rate-limit";

vi.mock("next/server", () => ({ connection: async () => {} }));

describe("MemoryLimiter", () => {
  it("allows the limit, refuses the next, and peek does not count", async () => {
    let t = 0;
    const lim = new MemoryLimiter(2, 1000, () => t);
    expect((await lim.peek("a")).remaining).toBe(2);
    expect((await lim.check("a")).ok).toBe(true);
    expect((await lim.check("a")).ok).toBe(true);
    expect((await lim.peek("a")).remaining).toBe(0);
    expect((await lim.check("a")).ok).toBe(false);
    t = 1001;
    expect((await lim.check("a")).ok).toBe(true);
  });

  it("hashes visitor IPs", () => {
    const id = visitorId(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }));
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(id).not.toContain("203");
  });
});

describe("health", () => {
  const SECRET = "qloo-secret-value-xyz";
  beforeAll(() => vi.stubEnv("UPSTASH_REDIS_REST_URL", ""));
  afterAll(() => vi.unstubAllEnvs());

  it("reports status and limits without secrets", async () => {
    const h = await getHealth({ TAKEOVER_MOCK: "1", QLOO_API_KEY: SECRET, ANTHROPIC_API_KEY: "sk-ant-not-a-real-key-000000000000" });
    expect(h).toMatchObject({
      mock: true,
      qloo: { reachable: null },
      redis: { configured: false },
      anthropic: { configured: true, planner: "claude", ok: true },
      limits: { runsPerVisitorPerHour: LIMITS.runsPerHour, dailyRuns: LIMITS.dailyRuns },
    });
    const json = JSON.stringify(h);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("sk-ant");
  });

  it("flags an unconfigured Qloo key outside mock mode", async () => {
    const h = await getHealth({});
    expect(h.qloo).toMatchObject({ configured: false, reachable: false });
    expect(h.ok).toBe(false);
  });

  it("GET /api/health returns JSON with no-store", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toHaveProperty("limits.dailyRemaining");
  });
});
