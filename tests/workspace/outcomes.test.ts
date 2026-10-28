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

describe("done when: three seeded plans", () => {
  /** A plan whose chosen city and partner are set, so the three plans differ. */
  function seeded(city: { id: string; name: string; combined: number }, partner: { name: string; score: number }): Plan {
    const p = structuredClone(template);
    Object.assign(p.city!.chosen!.pick.city, { id: city.id, name: city.name });
    p.city!.chosen!.pick.combined = city.combined;
    const chosen = p.partners!.picks.find((x) => x.pick.entity.id === p.partners!.chosenId)!.pick;
    chosen.entity.name = partner.name;
    chosen.entity.id = `partner-${partner.name}`;
    p.partners!.chosenId = chosen.entity.id;
    chosen.score = partner.score;
    return p;
  }

  it("give a report with the right sample sizes, every figure from the entries or the frozen plans", async () => {
    const { repo } = await person("seed@out.test");
    const plansIn = [
      seeded({ id: "c-austin", name: "Austin", combined: 0.91 }, { name: "Hot Ones", score: 0.72 }),
      seeded({ id: "c-austin", name: "Austin", combined: 0.88 }, { name: "SmartLess", score: 0.64 }),
      seeded({ id: "c-seattle", name: "Seattle", combined: 0.77 }, { name: "Hot Ones", score: 0.7 }),
    ];
    const ids: string[] = [];
    for (const p of plansIn) {
      const id = crypto.randomUUID();
      await repo.plans.create({ id, query: "Ali Wong", result: { ...p, runId: id } });
      ids.push(id);
    }
    const entries = [
      { ticketsSold: 1790, capacity: 1850, attendance: 1760, gross: 121400, sponsorRenewed: true },
      { ticketsSold: 640, capacity: 1000, attendance: 600 },
      { attendance: 450, notes: "No box office report yet" },
    ];
    for (const [i, e] of entries.entries()) await logOutcome(repo, ids[i], fields(e));

    // The stored plans change afterwards; the report must not.
    for (const id of ids) {
      const changed = seeded({ id: "c-x", name: "Changed City", combined: 0.123 }, { name: "Changed Partner", score: 0.456 });
      await db.update(plans).set({ result: changed }).where(eq(plans.id, id));
    }

    const v = await reportView(repo, "Seed");
    // Three logged, two with both tickets sold and capacity.
    expect(v.rows).toHaveLength(3);
    expect(v).toMatchObject({ sample: 2, judged: false, minSample: 5 });
    expect(v.median).toBeCloseTo((1790 / 1850 + 0.64) / 2);
    expect(v.cities.map((c) => [c.name, c.events, c.judged])).toEqual([["Austin", 2, false]]);
    expect(v.partners.map((c) => [c.name, c.events]).sort()).toEqual([
      ["Hot Ones", 1],
      ["SmartLess", 1],
    ]);
    expect(v.rows.map((r) => [r.city, r.partner, r.predictedCity, r.predictedPartner])).toEqual(
      expect.arrayContaining([
        ["Austin", "Hot Ones", 0.91, 0.72],
        ["Austin", "SmartLess", 0.88, 0.64],
        ["Seattle", "Hot Ones", 0.77, 0.7],
      ]),
    );
    const seattle = v.rows.find((r) => r.city === "Seattle")!;
    expect([seattle.sellThrough, seattle.aboveMedian]).toEqual([null, null]);

    // Every number in the CSV and the deck is an entry, a frozen prediction, or computed from them.
    const pct = (x: number) => String(Math.round(x * 100));
    const allowed = new Set<string>([
      ...entries.flatMap((e) => Object.values(e).filter((x): x is number => typeof x === "number").map(String)),
      "0.91", "0.72", "0.88", "0.64", "0.77", "0.70",
      pct(1790 / 1850), pct(0.64), pct(v.median!),
      String(v.sample), String(v.minSample), String(v.rows.length), "0", "1", "2",
    ]);
    const text = [outcomesCsv(v), ...outcomesOutline(v).flatMap((s) => [s.title, s.subtitle ?? "", s.note ?? "", ...(s.bullets ?? []), ...(s.table?.rows.flat() ?? [])])].join("\n");
    for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) expect(allowed.has(n), `unexpected figure ${n}`).toBe(true);
    expect(text).not.toContain("Changed");
    expect(text).not.toMatch(/0\.123|0\.456|\b12\b|\b46\b/);
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
