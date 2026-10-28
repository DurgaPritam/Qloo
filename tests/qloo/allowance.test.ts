import { describe, expect, it, vi } from "vitest";

import { allowanceConfig, MemoryCounters, monthKey, workspaceUsage, type AllowanceConfig } from "@/lib/qloo/allowance";
import { MemoryCache } from "@/lib/qloo/cache";
import { createQlooClient } from "@/lib/qloo/client";
import { BudgetExceededError } from "@/lib/qloo/errors";

const NOW = new Date("2026-11-03T10:00:00Z");
const ws = { kind: "workspace" as const, workspaceId: "ws-1" };
const job = { kind: "job" as const, workspaceId: "ws-1" };

function client(config: Partial<AllowanceConfig>, counters = new MemoryCounters()) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ results: { entities: [] } }), { status: 200 }));
  const c = createQlooClient({
    fetch: fetchMock,
    cache: new MemoryCache(),
    env: () => ({ QLOO_API_KEY: "k", QLOO_BASE_URL: "https://qloo.test" }),
    counters,
    allowance: () => ({ dailyCap: null, jobReserve: 0, workspaceMonthly: 500, ...config }),
    clock: () => NOW,
  });
  return { c, fetchMock, counters };
}

async function refused(p: Promise<unknown>): Promise<BudgetExceededError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BudgetExceededError);
  return err as BudgetExceededError;
}

describe("Qloo allowance", () => {
  it("stops a workspace at its monthly allowance, before calling Qloo, and names the limit", async () => {
    const { c, fetchMock } = client({ workspaceMonthly: 2 });
    await c.get("/search", { query: "a" }, { runId: "r", scope: ws });
    await c.get("/search", { query: "b" }, { runId: "r", scope: ws });
    const err = await refused(c.get("/search", { query: "c" }, { runId: "r", scope: ws }));
    expect(err.limitName).toBe("workspace");
    expect(err.message).toMatch(/workspace's monthly Qloo allowance/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The refused call gave its run slot back.
    expect(c.callCount("r")).toBe(2);
  });

  it("never counts cache hits, and an on-demand refresh skips the cache read", async () => {
    const { c, fetchMock, counters } = client({ workspaceMonthly: 5 });
    await c.get("/search", { query: "a" }, { runId: "r", scope: ws });
    const hit = await c.get("/search", { query: "a" }, { runId: "r", scope: ws });
    expect(hit.meta.cached).toBe(true);
    expect(await counters.read(monthKey("ws-1", NOW))).toBe(1);
    const fresh = await c.get("/search", { query: "a" }, { runId: "r", scope: ws, fresh: true });
    expect(fresh.meta.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await counters.read(monthKey("ws-1", NOW))).toBe(2);
  });

  it("applies the global daily cap to everyone, visitors included", async () => {
    const { c } = client({ dailyCap: 1 });
    await c.get("/search", { query: "a" }, { runId: "r" });
    expect((await refused(c.get("/search", { query: "b" }, { runId: "r2", scope: ws }))).limitName).toBe("daily");
  });

  it("keeps the job reserve of the daily cap for people", async () => {
    const counters = new MemoryCounters();
    const { c } = client({ dailyCap: 3, jobReserve: 2 }, counters);
    await c.get("/search", { query: "a" }, { runId: "r", scope: job });
    expect((await refused(c.get("/search", { query: "b" }, { runId: "r", scope: job }))).limitName).toBe("job_reserve");
    // A person can still use the reserve.
    await c.get("/search", { query: "c" }, { runId: "r", scope: ws });
    await c.get("/search", { query: "d" }, { runId: "r", scope: ws });
  });

  it("reads configuration and usage", async () => {
    expect(allowanceConfig({})).toEqual({ dailyCap: null, jobReserve: 0, workspaceMonthly: 500 });
    expect(allowanceConfig({ QLOO_DAILY_CALL_CAP: "300", QLOO_WORKSPACE_MONTHLY_CALLS: "40" })).toEqual({ dailyCap: 300, jobReserve: 30, workspaceMonthly: 40 });
    const counters = new MemoryCounters();
    await counters.charge({ dailyKey: "qloo:daily:2026-11-03", dailyCap: null, dailyKeep: 0, workspaceKey: monthKey("ws-1", NOW), workspaceCap: 40 });
    const usage = await workspaceUsage("ws-1", { counters, env: { QLOO_WORKSPACE_MONTHLY_CALLS: "40", QLOO_DAILY_CALL_CAP: "10", QLOO_JOB_RESERVE: "4" }, now: NOW });
    expect(usage).toEqual({ used: 1, allowance: 40, remaining: 39, dailyRemaining: 9, jobDailyRemaining: 5 });
  });
});
