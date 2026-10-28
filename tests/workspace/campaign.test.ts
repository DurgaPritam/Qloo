import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Plan } from "@/lib/agent/types";
import { briefCsv, briefNumbers, briefOutline, briefText, checkAngles, templateAngles, type CampaignBriefData } from "@/lib/campaign/brief";
import { BRIEF_CALLS, makeBrief } from "@/lib/campaign/service";
import type { DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { TENANT_TABLES } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import type { LLMProvider } from "@/lib/llm/types";
import { MockQlooSource } from "@/lib/qloo/mock";
import type { QlooSource } from "@/lib/qloo/source";
import { ForbiddenError } from "@/lib/workspace/permissions";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

let db: DB;
let queries: LoggedQuery[];
let template: Plan;

async function person(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  return { user, workspaceId, repo: forWorkspace(db, { userId: user.id, workspaceId, role: "owner" }) };
}
async function planIn(repo: ReturnType<typeof forWorkspace>) {
  const id = crypto.randomUUID();
  await repo.plans.create({ id, query: "Phoebe Bridgers", result: { ...template, runId: id } });
  return id;
}
/** Counts every call a source receives. */
function counting(source: QlooSource) {
  const seen: string[] = [];
  const proxy = new Proxy(source, {
    get(t, prop, r) {
      const v = Reflect.get(t, prop, r);
      return typeof v === "function" ? (...a: unknown[]) => (seen.push(String(prop)), (v as (...x: unknown[]) => unknown).apply(t, a)) : v;
    },
  });
  return { source: proxy, seen };
}
/** A source with no demographics (Qloo answered nothing). */
function noDemographics(): QlooSource {
  const mock = new MockQlooSource();
  return new Proxy(mock, {
    get(t, prop, r) {
      if (prop === "demographics") return async () => Promise.reject(new Error("no demographics"));
      return Reflect.get(t, prop, r);
    },
  });
}
const model = (text: string): LLMProvider => ({ name: "gemini", model: "test", chat: () => ({}) as never, complete: async () => ({ text, refused: false }) }) as unknown as LLMProvider;
const numbersIn = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];
const done = async (p: ReturnType<typeof makeBrief>) => {
  const r = await p;
  if (r.status !== "done") throw new Error(`expected a brief, got ${r.status}`);
  return r;
};

beforeAll(async () => {
  ({ db, queries } = await testDb());
  template = await runAgent({ query: "Phoebe Bridgers" }, { runId: "t", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
});
beforeEach(() => {
  queries.length = 0;
});

describe("a brief contains only engine numbers", () => {
  let brief: CampaignBriefData;
  beforeAll(async () => {
    const { repo } = await person("num@brief.test");
    brief = (await done(makeBrief(repo, { planId: await planIn(repo) }, { source: new MockQlooSource(), model: null, now: new Date("2026-10-28T10:00:00Z") }))).brief;
  });

  it("has interests by category, the plan's cities and keywords from Qloo names only", () => {
    expect(brief.interests.length).toBeGreaterThan(1);
    for (const g of brief.interests) for (let i = 1; i < g.items.length; i++) expect(g.items[i - 1].affinity).toBeGreaterThanOrEqual(g.items[i].affinity);
    expect(brief.cities.map((c) => c.score)).toEqual(template.city!.table.slice(0, 5).map((t) => Math.round(t.pick.combined * 100)));
    const names = new Set([...brief.interests.flatMap((g) => g.items.flatMap((i) => [i.name, ...i.tags])), ...brief.cities.map((c) => c.name)]);
    for (const k of brief.keywords) for (const w of k.keywords) expect(names.has(w), w).toBe(true);
  });

  it("every number in the deck and the CSV rows is an engine or Qloo figure", () => {
    const allowed = new Set([...briefNumbers(brief), "0", "1", "100"]);
    const deck = briefOutline(brief).flatMap((s) => [s.title, s.subtitle ?? "", s.note ?? "", ...(s.bullets ?? [])]);
    // Fact ids (F1…) carry a number but are labels, not figures.
    for (const line of deck) for (const n of numbersIn(line.replace(/\bF\d+\b/g, ""))) expect(allowed.has(n), `${n} in “${line}”`).toBe(true);
    for (const row of briefCsv(brief).trim().split("\r\n").slice(1)) for (const n of numbersIn(row)) expect(allowed.has(n), `${n} in ${row}`).toBe(true);
    expect(briefText(brief, "W")).not.toMatch(/\b(reach|impressions|CPM|budget):/i);
  });
});

describe("missing demographics", () => {
  it("shows the labelled fallback in the brief, its text and its deck, and still has interests and cities", async () => {
    const { repo } = await person("nodemo@brief.test");
    const { brief } = await done(makeBrief(repo, { planId: await planIn(repo) }, { source: noDemographics(), model: null, now: new Date() }));
    expect(brief.audience).toBeNull();
    expect(brief.audienceFallback).toMatch(/^Qloo has no demographics for Phoebe Bridgers/);
    expect(briefText(brief, "W")).toContain(brief.audienceFallback);
    expect(briefOutline(brief)[1].bullets).toEqual([brief.audienceFallback]);
    expect(brief.interests.length).toBeGreaterThan(0);
    expect(brief.cities.length).toBeGreaterThan(0);
  });
});

describe("creative angles", () => {
  const facts = [
    { id: "F1", text: "Fans over-index on Lucy Dacus (artists).", name: "Lucy Dacus" },
    { id: "F2", text: "Seattle is one of the strongest cities.", name: "Seattle" },
  ];
  const fallback = templateAngles(facts);

  it("keeps the model's angles that cite facts and mention them, and replaces the rest with labelled templates", () => {
    const out = checkAngles(
      [
        { title: "Dacus nights", body: "A Lucy Dacus listening party before the show.", facts: ["F1"] },
        { title: "Seattle", body: "Sell 5,000 tickets in Seattle with a big push.", facts: ["F2"] }, // a number
        { title: "Anywhere", body: "A general idea with no fact.", facts: ["F9"] }, // cites nothing real
      ],
      facts,
      fallback,
    );
    expect(out[0]).toMatchObject({ by: "model", facts: ["F1"] });
    expect(out.slice(1).every((a) => a.by === "template")).toBe(true);
    expect(checkAngles([{ title: "Reach", body: "Lucy Dacus fans: maximise reach and CPM.", facts: ["F1"] }], facts, fallback)[0].by).toBe("template");
    expect(checkAngles("not json", facts, fallback)).toEqual(fallback.slice(0, 3));
  });

  it("asks the model when there is one, and never lets it add a number", async () => {
    const { repo } = await person("model@brief.test");
    const planId = await planIn(repo);
    const bad = await done(makeBrief(repo, { planId }, { source: new MockQlooSource(), model: model('[{"title":"Big","body":"Reach 2 million fans","facts":["F1"]}]'), now: new Date() }));
    expect(bad.brief.angles.every((a) => a.by === "template" && !/\d/.test(a.body))).toBe(true);
  });
});

describe("making a brief", () => {
  it("from a plan: no search and no heatmap (the plan's cities), within the call budget, saved to the workspace", async () => {
    const { repo } = await person("plan@brief.test");
    const planId = await planIn(repo);
    queries.length = 0;
    const c = counting(new MockQlooSource());
    const r = await done(makeBrief(repo, { planId, title: "Late Set", flight: "March 2027" }, { source: c.source, model: null, now: new Date() }));
    expect(c.seen).not.toContain("searchEntities");
    expect(c.seen).not.toContain("heatmap");
    expect(c.seen.filter((s) => s !== "mock").length).toBeLessThanOrEqual(BRIEF_CALLS);
    expect(r.brief).toMatchObject({ title: "Late Set", flight: "March 2027", source: { kind: "plan", planId } });
    expect((await repo.briefs.get(r.id))!.planId).toBe(planId);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("from a fanbase alone: search, then a heatmap for its strongest cities", async () => {
    const { repo } = await person("fan@brief.test");
    const c = counting(new MockQlooSource());
    const r = await done(makeBrief(repo, { query: "John Mulaney" }, { source: c.source, model: null, now: new Date() }));
    expect(c.seen).toContain("searchEntities");
    expect(c.seen).toContain("heatmap");
    expect(r.brief.source).toEqual({ kind: "fanbase" });
    expect(r.brief.cities.length).toBeGreaterThan(0);
    expect((await repo.briefs.get(r.id))!.planId).toBeNull();
  });

  it("stays in its workspace; viewers read briefs but spend no Qloo calls trying to make one", async () => {
    const a = await person("one@brief.test");
    const b = await person("two@brief.test");
    const { id } = await done(makeBrief(a.repo, { planId: await planIn(a.repo) }, { source: new MockQlooSource(), model: null, now: new Date() }));
    expect(await b.repo.briefs.get(id)).toBeNull();
    const viewer = await addUser(db, "view@brief.test");
    const { token } = await a.repo.invitations.create(viewer.email, "viewer");
    await unscopedAcceptInvitation(db, token, viewer);
    const repo = forWorkspace(db, { userId: viewer.id, workspaceId: a.workspaceId, role: "viewer" });
    expect(await repo.briefs.get(id)).not.toBeNull();
    const c = counting(new MockQlooSource());
    await expect(makeBrief(repo, { query: "John Mulaney" }, { source: c.source, model: null, now: new Date() })).rejects.toBeInstanceOf(ForbiddenError);
    expect(c.seen).toEqual([]);
  });
});
