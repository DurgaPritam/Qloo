import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Plan } from "@/lib/agent/types";
import { briefText, buildBrief, interestsFromPlan } from "@/lib/campaign/brief";
import { makeBrief } from "@/lib/campaign/service";
import type { DB } from "@/lib/db";
import { forWorkspace, InputError } from "@/lib/db/scoped";
import { TENANT_TABLES } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import type { LLMProvider } from "@/lib/llm/types";
import { MockQlooSource } from "@/lib/qloo/mock";
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
/** A model that answers with a fixed sentence, to test the guard. */
const model = (text: string): LLMProvider => ({ name: "gemini", model: "test", chat: () => { throw new Error("no chat"); }, complete: async () => ({ text, refused: false }) }) as unknown as LLMProvider;

beforeAll(async () => {
  ({ db, queries } = await testDb());
  template = await runAgent({ query: "Phoebe Bridgers" }, { runId: "t", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
});
beforeEach(() => {
  queries.length = 0;
});

describe("the brief's figures come only from the plan and Qloo", () => {
  it("lists what the fans over-index on, best first, with the plan's own affinities", () => {
    const interests = interestsFromPlan(template);
    expect(interests.length).toBeGreaterThan(2);
    for (let i = 1; i < interests.length; i++) expect(interests[i - 1].affinity).toBeGreaterThanOrEqual(interests[i].affinity);
    const known = new Map([
      ...template.partners!.picks.map((p) => [p.pick.entity.name, p.pick.evidence.affinity] as const),
      ...template.room!.sponsors.map((s) => [s.pick.brand.name, s.pick.evidence.affinity] as const),
      ...(template.room!.opener ? [[template.room!.opener.pick.entity.name, template.room!.opener.pick.evidence.affinity] as const] : []),
    ]);
    for (const i of interests) expect(i.affinity).toBe(known.get(i.name));
  });

  it("takes cities and scores from the plan, keeps the user's flight and budget apart, and writes angles with no numbers", () => {
    const b = buildBrief(template, { planId: "p", flight: "March 2027", budget: null, audience: [], now: new Date("2026-10-28T10:00:00Z") });
    expect(b.cities.map((c) => c.score)).toEqual(template.city!.table.slice(0, 5).map((t) => Math.round(t.pick.combined * 100)));
    expect(b.yours).toEqual({ flight: "March 2027", budget: null });
    expect(b.angles.length).toBe(3);
    for (const a of b.angles) expect(a.body).not.toMatch(/\d/);
    const text = briefText(b, "North Star");
    expect(text).toContain("Budget: to confirm (your data)");
    expect(text).toContain("Flight: March 2027 (your data)");
  });
});

describe("making a brief", () => {
  it("asks Qloo only for demographics (at most 2 calls), saves it to the workspace, and records the requests", async () => {
    const { repo } = await person("cam@brief.test");
    const planId = await planIn(repo);
    queries.length = 0;
    const source = new MockQlooSource();
    let calls = 0;
    const counting = new Proxy(source, {
      get(t, prop, r) {
        const v = Reflect.get(t, prop, r);
        return typeof v === "function" && prop !== "mock" ? (...a: unknown[]) => (calls++, (v as (...x: unknown[]) => unknown).apply(t, a)) : v;
      },
    });
    const { id, brief } = await makeBrief(repo, { planId, title: "Late Set, spring 2027" }, { source: counting, model: null, now: new Date() });
    expect(calls).toBeLessThanOrEqual(2);
    expect(brief.title).toBe("Late Set, spring 2027");
    expect(brief.audience.length).toBeGreaterThan(0);
    expect(brief.sources.every((s) => s.params["signal.interests.entities"])).toBe(true);
    expect((await repo.briefs.get(id))!.data.title).toBe("Late Set, spring 2027");
    expect((await repo.briefs.list()).map((b) => b.id)).toEqual([id]);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("keeps the model's rephrasing only when it adds no number and drops no name", async () => {
    const { repo } = await person("mod@brief.test");
    const planId = await planIn(repo);
    const bad = await makeBrief(repo, { planId }, { source: new MockQlooSource(), model: model("Sell 5,000 tickets in a week."), now: new Date() });
    const plain = buildBrief(template, { planId, audience: [], now: new Date() });
    expect(bad.brief.angles.map((a) => a.body)).toEqual(plain.angles.map((a) => a.body));
  });

  it("stays in its workspace; viewers can read but not make one", async () => {
    const a = await person("one@brief.test");
    const b = await person("two@brief.test");
    const planId = await planIn(a.repo);
    const { id } = await makeBrief(a.repo, { planId }, { source: new MockQlooSource(), model: null, now: new Date() });
    expect(await b.repo.briefs.get(id)).toBeNull();
    await expect(makeBrief(b.repo, { planId }, { source: new MockQlooSource(), model: null, now: new Date() })).rejects.toBeInstanceOf(InputError);
    const viewer = await addUser(db, "view@brief.test");
    const { token } = await a.repo.invitations.create(viewer.email, "viewer");
    await unscopedAcceptInvitation(db, token, viewer);
    const repo = forWorkspace(db, { userId: viewer.id, workspaceId: a.workspaceId, role: "viewer" });
    expect(await repo.briefs.get(id)).not.toBeNull();
    await expect(makeBrief(repo, { planId }, { source: new MockQlooSource(), model: null, now: new Date() })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
