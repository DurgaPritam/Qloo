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
  it("lists artists, comedians, podcasts and brands for a known city, labelled as sample data", async () => {
    const res = await venue(postJson("http://localhost/api/tools/venue", { city: "Austin" }, "192.0.2.50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mock: true, city: { name: "Austin", country: "US" } });
    expect(body.lists.map((l: { kind: string }) => l.kind)).toEqual(["music", "comedy", "podcast", "brand"]);
    expect(body.calls).toHaveLength(4);
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
    expect(body.route.stops.length).toBeLessThanOrEqual(4);
  });

  it("takes the user's constraints, matches typed cities in the region and reports names it could not match", async () => {
    const req = { fanbase: "John Mulaney", stops: 4, maxLegKm: 3000, start: "Chicago", exclude: ["New York", "Atlantis"], region: "US" };
    const body = await (await tour(postJson("http://localhost/api/tools/tour", req, "192.0.2.91"))).json();
    expect(body.status).toBe("done");
    expect(body.understood).toMatchObject({ start: "Chicago", exclude: ["New York City"], unmatched: ["Atlantis"] });
    const stops = body.route.stops.map((s: { city: { name: string } }) => s.city.name);
    expect(stops[0]).toBe("Chicago");
    expect(stops).not.toContain("New York City");
    expect(body.route.stops.every((s: { legKm: number }) => s.legKm <= 3000)).toBe(true);
    const again = await (await tour(postJson("http://localhost/api/tools/tour", req, "192.0.2.92"))).json();
    expect(again.route).toEqual(body.route);
  });
  it("scores a mixed-country tour on one scale, keeping each country's own scale for display only", async () => {
    const body = await (await tour(postJson("http://localhost/api/tools/tour", { fanbase: "John Mulaney", stops: 4, region: "us-ca" }, "192.0.2.93"))).json();
    expect(body.status).toBe("done");
    expect(body.markets.map((m: { code: string }) => m.code).sort()).toEqual(["CA", "US"]);
    type Stop = { city: { country: string; score: number; countryScore: number } };
    const cities: Stop["city"][] = [...body.route.stops.map((s: Stop) => s.city), ...body.route.whyNot.map((w: { city: Stop["city"] }) => w.city)];
    // One region-wide maximum: at most one city anywhere scores 1; each country keeps its own top at 1 for display.
    expect(Math.max(...cities.map((c) => c.score))).toBeLessThanOrEqual(1);
    for (const c of cities) expect(c.countryScore).toBeGreaterThanOrEqual(c.score - 1e-9);
    const canada = cities.filter((c) => c.country === "CA");
    if (canada.length) expect(canada.some((c) => c.countryScore > c.score)).toBe(true);
  });

  it("limits a US region to its states, from one US heatmap", async () => {
    const body = await (await tour(postJson("http://localhost/api/tools/tour", { fanbase: "John Mulaney", stops: 4, region: "us-west", end: "Chicago" }, "192.0.2.94"))).json();
    expect(body.status).toBe("done");
    expect(body.states).toContain("California");
    expect(body.calls.filter((c: { params: Record<string, string> }) => c.params["filter.type"] === "urn:heatmap")).toHaveLength(1);
    // Chicago is in the Midwest, so it is not a city of this region and is reported, not routed.
    expect(body.understood.unmatched).toEqual(["Chicago"]);
    const names = body.route.stops.map((s: { city: { name: string } }) => s.city.name);
    expect(names).toContain("Los Angeles");
    expect(names).not.toContain("Chicago");
    expect(names).not.toContain("New York City");
  });

  it("takes the user's distance weight: 0 ignores distance, a high weight shortens the route", async () => {
    const at = async (w: number, ip: string) => (await (await tour(postJson("http://localhost/api/tools/tour", { fanbase: "John Mulaney", stops: 4, region: "US", distanceWeight: w }, ip))).json()).route;
    const free = await at(0, "192.0.2.96");
    const tight = await at(20, "192.0.2.97");
    expect(free.distanceWeight).toBe(0);
    expect(tight.distanceWeight).toBe(20);
    expect(tight.totalKm).toBeLessThanOrEqual(free.totalKm);
    expect(free.scoreSum).toBeGreaterThanOrEqual(tight.scoreSum);
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

describe("lineup optimizer", () => {
  it("matches names, scores the pool's pairwise affinities, and saves a poster scored from the draft only", async () => {
    const { POST: resolve } = await import("@/app/api/tools/lineup/resolve/route");
    const { POST: score } = await import("@/app/api/tools/lineup/route");
    const { POST: save } = await import("@/app/api/tools/lineup/save/route");
    const { crowdFit } = await import("@/lib/engine/lineup");
    const names = ["John Mulaney", "Phoebe Bridgers", "Ali Wong"];
    const matched = await (await resolve(postJson("http://localhost/api/tools/lineup/resolve", { acts: names.map((name) => ({ name })) }, "192.0.2.110"))).json();
    const acts = matched.acts.filter((a: { status: string }) => a.status === "resolved").map((a: { entity: unknown }) => a.entity);
    expect(acts.length).toBeGreaterThanOrEqual(2);
    const draft = await (await score(postJson("http://localhost/api/tools/lineup", { acts }, "192.0.2.111"))).json();
    expect(Object.keys(draft.matrix).sort()).toEqual(acts.map((a: { id: string }) => a.id).sort());
    expect(draft.calls.length).toBeLessThanOrEqual(acts.length * 2);

    const ids = acts.map((a: { id: string }) => a.id);
    const ok = await save(postJson("http://localhost/api/tools/lineup/save", { draftId: draft.draftId, actIds: ids, tiers: { [ids[1]]: "A" }, title: "Night One", crowdFit: 999 }));
    const saved = await ok.json();
    expect(saved).toMatchObject({ title: "Night One", headliner: { id: ids[1] } });
    expect(saved.crowdFit).toBe(Math.round(crowdFit(ids, draft.matrix) * 100));

    const forged = await save(postJson("http://localhost/api/tools/lineup/save", { draftId: draft.draftId, actIds: [ids[0], "not-in-the-pool"] }));
    expect(forged.status).toBe(400);
  });
});

describe("votes", () => {
  it("counts one vote per visitor per question and refuses options the plan doesn't have", async () => {
    const { POST: plan } = await import("@/app/api/plan/route");
    const { GET: votes, POST: vote } = await import("@/app/api/votes/route");
    const { readEvents } = await import("./sse");
    const events = await readEvents(await plan(postJson("http://localhost/api/plan", { query: "John Mulaney" }, "192.0.2.120")));
    const p = events.at(-1)!.data as { runId: string; partners: { picks: { pick: { entity: { id: string } } }[] } };
    const [a, b] = p.partners.picks.map((x) => x.pick.entity.id);
    const cast = (option: string, ip: string) =>
      vote(postJson("http://localhost/api/votes", { runId: p.runId, question: "partner", option }, ip));

    await cast(a, "192.0.2.121");
    await cast(a, "192.0.2.122");
    const changed = await (await cast(b, "192.0.2.122")).json();
    expect(changed.partner.counts).toEqual({ [a]: 1, [b]: 1 });
    expect(changed.partner.mine).toBe(b);
    expect((await cast("nope", "192.0.2.123")).status).toBe(400);

    const read = await (await votes(new Request(`http://localhost/api/votes?runId=${p.runId}`))).json();
    expect(read.partner.counts).toEqual({ [a]: 1, [b]: 1 });
  });
});
