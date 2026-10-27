import { describe, expect, it, vi } from "vitest";

import { cacheKey, MemoryCache, TieredCache, type CacheStore } from "@/lib/qloo/cache";
import { createQlooClient, QLOO_RUN_BUDGET, type QlooClientDeps } from "@/lib/qloo/client";
import {
  BudgetExceededError,
  NotFoundError,
  QlooError,
  RateLimitedError,
  UpstreamError,
} from "@/lib/qloo/errors";

const API_KEY = "test-secret-key-123";
const run = { runId: "run-1" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function setup(responses: Array<() => Response | Promise<Response>>, deps: QlooClientDeps = {}) {
  let i = 0;
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const next = responses[Math.min(i++, responses.length - 1)];
    return next();
  });
  const sleep = vi.fn(async () => {});
  const client = createQlooClient({
    fetch: fetchMock,
    cache: new MemoryCache(),
    env: () => ({ QLOO_API_KEY: API_KEY, QLOO_BASE_URL: "https://qloo.test/" }),
    sleep,
    ...deps,
  });
  return { client, fetchMock, sleep };
}

async function catchError(promise: Promise<unknown>): Promise<QlooError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof QlooError) return err;
    throw err;
  }
  throw new Error("expected the call to fail");
}

describe("cacheKey", () => {
  it("is independent of param order", () => {
    expect(cacheKey("/v2/insights", { b: "2", a: "1" })).toBe(
      cacheKey("/v2/insights", { a: "1", b: "2" }),
    );
  });

  it("drops empty values and joins arrays", () => {
    expect(cacheKey("/v2/insights", { ids: ["x", "y"], none: undefined, blank: "", nil: null })).toBe(
      "qloo:v1:/v2/insights?ids=x%2Cy",
    );
  });

  it("distinguishes paths and values", () => {
    const base = cacheKey("/search", { query: "taylor swift" });
    expect(cacheKey("/v2/insights", { query: "taylor swift" })).not.toBe(base);
    expect(cacheKey("/search", { query: "beyonce" })).not.toBe(base);
    expect(cacheKey("/search", {})).toBe("qloo:v1:/search");
  });
});

describe("qlooGet request", () => {
  it("sends the key as a header only and returns safe meta", async () => {
    const { client, fetchMock } = setup([() => json({ results: [] })]);

    const res = await client.get("/search", { types: ["urn:entity:artist"], query: "BTS" }, run);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qloo.test/search?query=BTS&types=urn%3Aentity%3Aartist");
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe(API_KEY);
    expect(res.data).toEqual({ results: [] });
    expect(res.meta).toMatchObject({
      endpoint: "/search",
      params: { query: "BTS", types: "urn:entity:artist" },
      cached: false,
    });
    expect(JSON.stringify(res)).not.toContain(API_KEY);
  });

  it("serves repeats from cache", async () => {
    const { client, fetchMock } = setup([() => json({ ok: 1 })]);

    await client.get("/search", { query: "a" }, run);
    const second = await client.get("/search", { query: "a" }, run);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ data: { ok: 1 }, meta: { cached: true } });
  });
});

describe("per-run budget", () => {
  it(`allows ${QLOO_RUN_BUDGET} uncached calls, then throws without fetching`, async () => {
    const { client, fetchMock } = setup([() => json({})]);

    for (let i = 0; i < QLOO_RUN_BUDGET; i++) {
      await client.get("/search", { query: `q${i}` }, run);
    }
    const err = await catchError(client.get("/search", { query: "one too many" }, run));

    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toMatchObject({ runId: "run-1", limit: QLOO_RUN_BUDGET });
    expect(fetchMock).toHaveBeenCalledTimes(QLOO_RUN_BUDGET);
    expect(client.callCount("run-1")).toBe(QLOO_RUN_BUDGET);
  });

  it("does not charge cache hits, even past the limit", async () => {
    const { client } = setup([() => json({})], { budget: 2 });

    await client.get("/search", { query: "a" }, run);
    await client.get("/search", { query: "b" }, run);
    for (let i = 0; i < 5; i++) {
      await expect(client.get("/search", { query: "a" }, run)).resolves.toMatchObject({
        meta: { cached: true },
      });
    }
    expect(client.callCount("run-1")).toBe(2);
  });

  it("counts a retried call once and tracks runs separately", async () => {
    const { client, fetchMock } = setup(
      [() => json({}, 503), () => json({}), () => json({})],
      { budget: 1 },
    );

    await client.get("/search", { query: "a" }, run);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.callCount("run-1")).toBe(1);

    await expect(client.get("/search", { query: "b" }, { runId: "run-2" })).resolves.toBeDefined();
    await expect(client.get("/search", { query: "c" }, run)).rejects.toBeInstanceOf(BudgetExceededError);

    client.endRun("run-1");
    expect(client.callCount("run-1")).toBe(0);
  });
});

describe("error mapping", () => {
  it("maps 404 to NotFound without retrying", async () => {
    const { client, fetchMock } = setup([() => json({}, 404)]);

    const err = await catchError(client.get("/search", { query: "nope" }, run));

    expect(err).toBeInstanceOf(NotFoundError);
    expect(err).toMatchObject({ status: 404, endpoint: "/search" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 429 once, honouring Retry-After, then maps to RateLimited", async () => {
    const { client, fetchMock, sleep } = setup([() => json({}, 429, { "Retry-After": "1" })]);

    const err = await catchError(client.get("/search", { query: "x" }, run));

    expect(err).toBeInstanceOf(RateLimitedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("recovers when the retry succeeds", async () => {
    const { client, fetchMock } = setup([() => json({}, 500), () => json({ ok: true })]);

    const res = await client.get("/search", { query: "x" }, run);

    expect(res.data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps repeated 5xx to Upstream", async () => {
    const { client, fetchMock } = setup([() => json({}, 502)]);

    const err = await catchError(client.get("/search", { query: "x" }, run));

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps other 4xx to Upstream without retrying", async () => {
    const { client, fetchMock } = setup([() => json({ error: "bad param" }, 400)]);

    const err = await catchError(client.get("/search", { query: "x" }, run));

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a timeout to Upstream", async () => {
    const { client } = setup([], {
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    });

    const err = await catchError(client.get("/search", { query: "slow" }, run));

    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toMatch(/timed out after 10ms/);
  });

  it("gives heatmaps a longer timeout than other calls", async () => {
    const slow = (ms: number) => (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(json({ results: { heatmap: [] } })), ms);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const { client } = setup([], { timeoutMs: 10, fetch: slow(40) as typeof fetch });

    await expect(client.get("/v2/insights", { "filter.type": "urn:heatmap" }, run)).resolves.toBeDefined();
    const err = await catchError(client.get("/v2/insights", { "filter.type": "urn:entity:artist" }, run));
    expect(err.message).toMatch(/timed out after 10ms/);
  });

  it("maps network failures and invalid JSON to Upstream", async () => {
    const network = setup([], { fetch: async () => Promise.reject(new TypeError("fetch failed")) });
    expect(await catchError(network.client.get("/search", { q: "1" }, run))).toBeInstanceOf(
      UpstreamError,
    );

    const garbage = setup([() => new Response("<html>", { status: 200 })]);
    const err = await catchError(garbage.client.get("/search", { q: "1" }, run));
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toMatch(/invalid JSON/);
  });

  it("never leaks the key in error messages or params", async () => {
    const { client } = setup([() => json({ error: `bad key ${API_KEY}` }, 401)]);

    const err = await catchError(client.get("/search", { echo: API_KEY }, run));

    expect(err.message).not.toContain(API_KEY);
    expect(JSON.stringify(err.params)).not.toContain(API_KEY);
    expect(err.message).toContain("[redacted]");
  });

  it("fails on missing config without charging the budget", async () => {
    const { client, fetchMock } = setup([() => json({})], { env: () => ({}) });

    await expect(client.get("/search", { query: "x" }, run)).rejects.toThrow("QLOO_API_KEY is not set");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.callCount("run-1")).toBe(0);
  });
});

describe("cache fallback", () => {
  it("keeps working from memory when Redis is down", async () => {
    const down: CacheStore = {
      get: vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))),
      set: vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))),
    };
    const warn = vi.fn();
    const { client, fetchMock } = setup([() => json({ ok: 1 })], {
      cache: new TieredCache(new MemoryCache(), down, warn),
    });

    await client.get("/search", { query: "a" }, run);
    const second = await client.get("/search", { query: "a" }, run);

    expect(second.meta.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it("expires memory entries after their TTL", async () => {
    let t = 0;
    const cache = new MemoryCache(10, () => t);
    await cache.set("k", 1, 60);
    t = 59_999;
    expect(await cache.get("k")).toBe(1);
    t = 60_000;
    expect(await cache.get("k")).toBeNull();
  });
});

describe("cache lifetime", () => {
  it("stores without expiry when ttl is 0 (warm cache)", async () => {
    let t = 0;
    const cache = new MemoryCache(10, () => t);
    await cache.set("k", 1, 0);
    t = 10 * 365 * 24 * 3600 * 1000;
    expect(await cache.get("k")).toBe(1);
  });
});
