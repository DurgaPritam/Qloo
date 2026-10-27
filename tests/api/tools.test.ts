import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as brand } from "@/app/api/tools/brand/route";
import { POST as cities } from "@/app/api/tools/cities/route";
import { GET as suggest } from "@/app/api/suggest/route";
import { POST as audience } from "@/app/api/tools/audience/route";
import { POST as overlap } from "@/app/api/tools/overlap/route";
import { POST as tour } from "@/app/api/tools/tour/route";
import { POST as venue } from "@/app/api/tools/venue/route";

import { postJson } from "./sse";

vi.mock("next/server", () => ({ connection: async () => {} }));

beforeAll(() => {
  vi.stubEnv("TAKEOVER_MOCK", "1");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});
afterAll(() => vi.unstubAllEnvs());

describe("POST /api/tools/venue", () => {
  it("lists artists, comedians and podcasts for a known city, labelled as sample data", async () => {
    const res = await venue(postJson("http://localhost/api/tools/venue", { city: "Austin" }, "192.0.2.50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mock: true, city: { name: "Austin", country: "US" } });
    expect(body.lists.map((l: { kind: string }) => l.kind)).toEqual(["music", "comedy", "podcast"]);
    expect(body.calls).toHaveLength(3);
    const comedy = body.calls.find((c: { params: Record<string, string> }) => c.params["filter.type"] === "urn:entity:person");
    expect(comedy.params["filter.tags"]).toBe("urn:tag:occupation:person:stand_up_comedian");
  });

  it("says so for an unknown city and validates input", async () => {
    expect((await venue(postJson("http://localhost/api/tools/venue", { city: "Nowhereville" }, "192.0.2.51"))).status).toBe(404);
    expect((await venue(postJson("http://localhost/api/tools/venue", { city: "" }, "192.0.2.51"))).status).toBe(400);
  });

  it("limits each visitor to 30 lookups an hour", async () => {
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await venue(postJson("http://localhost/api/tools/venue", { city: "Austin" }, "192.0.2.52"))).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/tools/brand", () => {
  it("scores four partner lists and cities in the brand's market", async () => {
    const res = await brand(postJson("http://localhost/api/tools/brand", { brand: "Patagonia" }, "192.0.2.60"));
    const body = await res.json();
    expect(body).toMatchObject({ status: "done", mock: true, market: { code: "US" } });
    expect(body.lists.map((l: { category: string }) => l.category)).toEqual(["artist", "person", "podcast", "tv_show"]);
    expect(body.cities.length).toBeGreaterThan(0);
  });
});

describe("POST /api/tools/cities", () => {
  it("returns cities in four markets, home first", async () => {
    const res = await cities(postJson("http://localhost/api/tools/cities", { fanbase: "John Mulaney" }, "192.0.2.70"));
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.markets).toHaveLength(4);
    expect(body.markets[0].home).toBe(true);
  });
});

describe("POST /api/tools/overlap", () => {
  it("scores both directions, finds shared cities and profiles both audiences", async () => {
    const res = await overlap(postJson("http://localhost/api/tools/overlap", { a: "John Mulaney", b: "Succession" }, "192.0.2.80"));
    const body = await res.json();
    expect(body).toMatchObject({ status: "done", mock: true });
    expect(typeof body.bAmongA).toBe("number");
    expect(["strong", "clear", "some"]).toContain(body.level);
    expect(body.audiences).toHaveLength(2);
    expect(body.calls.length).toBeLessThanOrEqual(8);
  });

  it("needs two names", async () => {
    expect((await overlap(postJson("http://localhost/api/tools/overlap", { a: "x" }, "192.0.2.81"))).status).toBe(400);
  });
});

describe("POST /api/tools/tour", () => {
  it("routes the requested number of stops at most", async () => {
    const body = await (await tour(postJson("http://localhost/api/tools/tour", { fanbase: "John Mulaney", stops: 4 }, "192.0.2.90"))).json();
    expect(body.status).toBe("done");
    expect(body.tour.stops.length).toBeLessThanOrEqual(4);
  });
});

describe("POST /api/tools/audience", () => {
  it("returns a profile per id, at most two", async () => {
    const body = await (await audience(postJson("http://localhost/api/tools/audience", { entityIds: ["a", "b", "c"] }, "192.0.2.95"))).json();
    expect(body.profiles.map((p: { entityId: string }) => p.entityId)).toEqual(["a", "b"]);
  });
});

describe("GET /api/suggest", () => {
  it("suggests from three characters and stays quiet below", async () => {
    const short = await (await suggest(new Request("http://localhost/api/suggest?q=jo"))).json();
    expect(short.suggestions).toEqual([]);
    const body = await (await suggest(new Request("http://localhost/api/suggest?q=John Mulaney", { headers: { "x-forwarded-for": "192.0.2.99" } }))).json();
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions[0]).toHaveProperty("name");
  });
});
