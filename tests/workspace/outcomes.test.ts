import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Plan } from "@/lib/agent/types";
import type { DB } from "@/lib/db";
import { forWorkspace, InputError } from "@/lib/db/scoped";
import { planPredictions, plans, TENANT_TABLES } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { outcomesCsv, outcomesOutline } from "@/lib/export/outcomes";
import { MockQlooSource } from "@/lib/qloo/mock";
import { logOutcome, parseOutcome, planOutcome, reportView } from "@/lib/outcomes/service";
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

const fields = (x: Partial<Record<string, unknown>>) => parseOutcome(x as Record<string, unknown>);

beforeAll(async () => {
  ({ db, queries } = await testDb());
  template = await runAgent({ query: "Phoebe Bridgers" }, { runId: "t", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
});
beforeEach(() => {
  queries.length = 0;
});

describe("predictions are frozen at plan time", () => {
  it("are written when the plan is saved and are what the comparison shows, even if the plan's data changes later", async () => {
    const { repo } = await person("ana@out.test");
    const id = await planIn(repo);
    const frozen = (await repo.outcomes.prediction(id))!;
    expect(frozen.predicted.city?.name).toBe(template.city!.chosen!.pick.city.name);
    expect(frozen.predicted.city?.combined).toBe(template.city!.chosen!.pick.combined);
    expect(frozen.predicted.partner?.score).toBe(template.partners!.picks.find((p) => p.pick.entity.id === template.partners!.chosenId)!.pick.score);

    // Someone (or a future engine) changes the stored plan: the prediction does not move.
    const changed = structuredClone(template);
    changed.city!.chosen!.pick.city.name = "Somewhere Else";
    changed.city!.chosen!.pick.combined = 0.01;
    await db.update(plans).set({ result: changed }).where(eq(plans.id, id));
    await logOutcome(repo, id, fields({ ticketsSold: 900, capacity: 1000 }));
    const view = (await planOutcome(repo, id))!;
    expect(view.prediction?.city?.name).toBe(template.city!.chosen!.pick.city.name);
    expect(view.lines[0].predicted).toContain(`${Math.round(template.city!.chosen!.pick.combined * 100)} / 100`);
    expect(view.predictedAt).toBe(frozen.createdAt.toISOString());
  });

  it("for a plan saved before Outcomes, freezes the plan as stored, dated when it was made", async () => {
    const { repo, workspaceId } = await person("bo@out.test");
    const id = await planIn(repo);
    await db.delete(planPredictions).where(and(eq(planPredictions.planId, id), eq(planPredictions.workspaceId, workspaceId)));
    const plan = (await repo.plans.get(id))!;
    await logOutcome(repo, id, fields({ attendance: 500 }));
    const frozen = (await repo.outcomes.prediction(id))!;
    expect(frozen.createdAt.toISOString()).toBe(plan.createdAt.toISOString());
    expect((await planOutcome(repo, id))!.backfilled).toBe(false);
  });
});

describe("sell-through and calibration pairs", () => {
  it("are computed only when both tickets sold and capacity are entered", async () => {
    const { repo } = await person("cy@out.test");
    const id = await planIn(repo);
    await logOutcome(repo, id, fields({ ticketsSold: "1,790", attendance: 1700, notes: "Floor sold out" }));
    let view = (await planOutcome(repo, id))!;
    expect(view.sellThrough).toBeNull();
    expect(view.lines[0]).toMatchObject({ actual: "—", result: "Needs tickets sold and capacity" });
    expect(await repo.outcomes.calibration()).toEqual([]);
    const row = (await repo.outcomes.get(id))!;
    expect(row).toMatchObject({ source: "user", ticketsSold: 1790, capacity: null, attendance: 1700, notes: "Floor sold out" });

    await logOutcome(repo, id, fields({ ticketsSold: 1790, capacity: 1850, gross: "121,400.50", sponsorRenewed: true }));
    view = (await planOutcome(repo, id))!;
    expect(view.sellThrough).toBeCloseTo(1790 / 1850);
    expect(view.outcome).toMatchObject({ gross: 121400.5, sponsorRenewed: true, attendance: null });
    const pairs = await repo.outcomes.calibration();
    expect(pairs.map((p) => [p.kind, p.outcomeMetric]).sort()).toEqual([
      ["city", "sell_through"],
      ["partner", "sell_through"],
    ]);
    expect(pairs.every((p) => Math.abs(p.outcomeValue - 1790 / 1850) < 1e-9)).toBe(true);
    expect(pairs.find((p) => p.kind === "city")!.predictedScore).toBe(view.prediction!.city!.combined);
  });

  it("rejects numbers that are not counts, and keeps every field optional", () => {
    expect(() => fields({ ticketsSold: "12.5" })).toThrow(/whole number/);
    expect(() => fields({ capacity: -3 })).toThrow(/whole number/);
    expect(() => fields({ gross: "lots" })).toThrow(/Gross/);
    expect(fields({})).toEqual({ attendance: null, ticketsSold: null, capacity: null, gross: null, sponsorRenewed: null, notes: null });
  });
});

describe("workspace report", () => {
  it("says too few events to judge below the minimum, then compares with the workspace's own median", async () => {
    const { repo } = await person("dee@out.test");
    const sells = [[900, 1000], [700, 1000], [600, 1000], [950, 1000]];
    for (const [s, c] of sells) await logOutcome(repo, await planIn(repo), fields({ ticketsSold: s, capacity: c }));
    let v = await reportView(repo, "Dee's");
    expect(v).toMatchObject({ sample: 4, judged: false, minSample: 5 });
    expect(outcomesCsv(v)).toContain("too few events to judge");
    expect(outcomesOutline(v).map((s) => s.title)).toContain("Too few events to judge");

    await logOutcome(repo, await planIn(repo), fields({ ticketsSold: 500, capacity: 1000 }));
    await logOutcome(repo, await planIn(repo), fields({ attendance: 10 })); // no sell-through: not in the sample
    v = await reportView(repo, "Dee's");
    expect(v).toMatchObject({ sample: 5, judged: true, median: 0.7, aboveMedian: 2 });
    expect(v.rows).toHaveLength(6);
    expect(v.cities[0]).toMatchObject({ events: 5, above: 2, judged: true });
    const csv = outcomesCsv(v);
    expect(csv.split("\r\n")[0]).toContain("tickets_sold_your_data");
    expect(csv).toMatch(/,90%,/);
  });
});

describe("scoping and roles", () => {
  it("keeps outcomes, predictions and calibration pairs inside their workspace", async () => {
    const a = await person("eve@out.test");
    const b = await person("fin@out.test");
    const id = await planIn(a.repo);
    await logOutcome(a.repo, id, fields({ ticketsSold: 10, capacity: 20 }));
    queries.length = 0;
    expect(await b.repo.outcomes.get(id)).toBeNull();
    expect(await b.repo.outcomes.prediction(id)).toBeNull();
    expect(await b.repo.outcomes.logged()).toEqual([]);
    expect(await b.repo.outcomes.calibration()).toEqual([]);
    expect(await planOutcome(b.repo, id)).toBeNull();
    await expect(logOutcome(b.repo, id, fields({ ticketsSold: 1 }))).rejects.toBeInstanceOf(InputError);
    expect((await a.repo.outcomes.get(id))!.ticketsSold).toBe(10);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("lets viewers read results but not log them", async () => {
    const owner = await person("gil@out.test");
    const viewer = await addUser(db, "hu@out.test");
    const { token } = await owner.repo.invitations.create(viewer.email, "viewer");
    await unscopedAcceptInvitation(db, token, viewer);
    const repo = forWorkspace(db, { userId: viewer.id, workspaceId: owner.workspaceId, role: "viewer" });
    const id = await planIn(owner.repo);
    expect((await planOutcome(repo, id))!.outcome).toBeNull();
    await expect(logOutcome(repo, id, fields({ ticketsSold: 1 }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
