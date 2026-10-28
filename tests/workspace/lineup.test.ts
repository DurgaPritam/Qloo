import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Plan } from "@/lib/agent/types";
import type { DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { TENANT_TABLES } from "@/lib/db/schema";
import { unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { MockQlooSource } from "@/lib/qloo/mock";
import type { QlooSource } from "@/lib/qloo/source";
import { lineupDraft, lineupFromDraft, lineupPool } from "@/lib/tools/lineup-pool";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

let db: DB;
let queries: LoggedQuery[];
let template: Plan;

beforeAll(async () => {
  ({ db, queries } = await testDb());
  template = await runAgent({ query: "John Mulaney" }, { runId: "t", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
});
beforeEach(() => {
  queries.length = 0;
});

describe("the lineup optimizer's pool and save", () => {
  it("takes fits from Qloo (affinity × 100), never the headliner, and keeps the pool as a draft", async () => {
    const source = new MockQlooSource();
    const r = await lineupPool({ entity: template.fanbase! }, { planId: "p", city: "Seattle" }, source, { runId: "l" });
    if (r.status !== "done") throw new Error("expected a pool");
    expect(r.pool.length).toBeGreaterThanOrEqual(3);
    expect(r.pool.map((a) => a.id)).not.toContain(template.fanbase!.id);
    const qloo = await (source as QlooSource).candidates([template.fanbase!.id], template.fanbase!.category, undefined, { runId: "x" });
    const affinity = new Map(qloo.data.map((c) => [c.id, c.affinity]));
    for (const a of r.pool.filter((x) => affinity.has(x.id))) expect(a.fit).toBe(Math.round(affinity.get(a.id)! * 100));
    expect(r.calls.length).toBeLessThanOrEqual(2); // no search: the plan's fanbase is the headliner
    const { status: _status, ...kept } = r;
    expect(await lineupDraft(r.draftId)).toEqual(kept);
  });

  it("saves the engine's pick from the draft's own fits with the user's fees, to the plan", async () => {
    const user = await addUser(db, "lin@lineup.test", "lin");
    const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
    const repo = forWorkspace(db, { userId: user.id, workspaceId, role: "owner" });
    const planId = crypto.randomUUID();
    await repo.plans.create({ id: planId, query: "John Mulaney", result: { ...template, runId: planId } });
    const r = await lineupPool({ entity: template.fanbase! }, { planId, city: null }, new MockQlooSource(), { runId: "l2" });
    if (r.status !== "done") throw new Error("expected a pool");
    const draft = (await lineupDraft(r.draftId))!;
    const yours = { budget: 100_000, slots: 3, fees: { A: 60_000, B: 15_000, C: 5_000 }, tiers: Object.fromEntries(draft.pool.map((a) => [a.id, "B" as const])), headlinerTier: "A" as const };
    const pick = lineupFromDraft(draft, yours)!;
    expect(pick.slots[0]).toMatchObject({ role: "Headliner", name: template.fanbase!.name });
    expect(pick.slots.slice(1).map((s) => s.fit)).toEqual(draft.pool.slice(0, 2).map((a) => a.fit)); // the two best fits, all tier B
    expect(pick.cost).toBe(90_000);
    queries.length = 0;
    await repo.lineups.save(planId, pick, yours);
    expect((await repo.lineups.get(planId))!.lineup).toEqual(pick);
    expectAllScoped(queries, TENANT_TABLES);
    expect(lineupFromDraft(draft, { ...yours, budget: 70_000 })).toBeNull();
  });
});
