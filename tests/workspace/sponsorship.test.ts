import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { DB } from "@/lib/db";
import { forWorkspace, InputError } from "@/lib/db/scoped";
import { TENANT_TABLES } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { scoreSponsorFit } from "@/lib/engine/sponsor";
import type { Brand } from "@/lib/engine/types";
import { MockQlooSource } from "@/lib/qloo/mock";
import type { QlooSource } from "@/lib/qloo/source";
import { findAct } from "@/lib/roster/resolve";
import { runBrandView, runRightsView, shortlistMatch, type SponsorRun } from "@/lib/sponsorship/service";
import { ForbiddenError } from "@/lib/workspace/permissions";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

let db: DB;
let queries: LoggedQuery[];

async function person(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  return { user, workspaceId, repo: forWorkspace(db, { userId: user.id, workspaceId, role: "owner" }) };
}

/** The mock, with a rival team, a league and a nonprofit slipped into every brand list. */
function withRivals(): QlooSource {
  const mock = new MockQlooSource();
  const extra: Brand[] = [
    { id: "rival-fc", name: "Rival F.C.", affinity: 0.99, popularity: 0.9, tags: ["Sports Organization", "England Soccer"] },
    { id: "league", name: "Premier League", affinity: 0.99, popularity: 0.9, brandTypes: ["Entertainment Brand"] },
    { id: "charity", name: "A Charity", affinity: 0.99, popularity: 0.9, brandTypes: ["Nonprofit Brand"] },
  ];
  return new Proxy(mock, {
    get(target, prop, receiver) {
      if (prop === "brands") {
        return async (...args: Parameters<QlooSource["brands"]>) => {
          const res = await (target as QlooSource).brands(...args);
          return { ...res, data: [...res.data, ...extra] };
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

const done = (r: SponsorRun) => {
  if (r.status !== "done") throw new Error(`expected results, got ${r.status}`);
  return r;
};
const matches = (r: Extract<SponsorRun, { status: "done" }>) => r.groups.flatMap((g) => g.matches);

beforeAll(async () => {
  ({ db, queries } = await testDb());
});
beforeEach(() => {
  queries.length = 0;
  vi.stubEnv("TAKEOVER_MOCK", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("brand view", () => {
  it("lists talent, shows and podcasts for a brand, each fit scored by the engine from Qloo both ways", async () => {
    const { repo } = await person("ana@sp.test");
    const r = done(await runBrandView(repo, { query: "Liquid Death" }, new MockQlooSource()));
    const all = matches(r);
    expect(all.length).toBeGreaterThan(2);
    for (const m of all) {
      // The fit is exactly the engine's for the two Qloo values it carries.
      expect(m.fit).toEqual(scoreSponsorFit({ name: m.pitch.holder }, { name: m.pitch.brand }, { forward: m.fit.forward, backward: m.fit.backward }));
      expect(m.fit.forward).not.toBeNull();
      expect(m.fit.backward).not.toBeNull();
      expect(m.pitch.audience?.of).toBe(r.subject.name);
    }
    expect(all.map((m) => m.fit.fit)).toEqual([...all.map((m) => m.fit.fit)].sort((a, b) => b - a));
    expect(r.calls).toBeLessThanOrEqual(25);
  });
});

describe("rights-holder view", () => {
  it("ranks brands to pitch by fit, grouped by sector, never a rival team, a league or a nonprofit", async () => {
    const { repo } = await person("bo@sp.test");
    const r = done(await runRightsView(repo, { kind: "entity", query: "Phoebe Bridgers" }, withRivals()));
    const names = matches(r).map((m) => m.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain("Rival F.C.");
    expect(names).not.toContain("Premier League");
    expect(names).not.toContain("A Charity");
    expect(r.groups.every((g) => g.label.length > 0)).toBe(true);
    // The best five have both directions; the rest are one-way, said so.
    const both = matches(r).filter((m) => m.fit.backward !== null).length;
    expect(both).toBeGreaterThan(0);
    expect(both).toBeLessThanOrEqual(5);
    for (const m of matches(r)) expect(m.fit.evidence.some((e) => e.kind === "to_confirm")).toBe(true);
  });

  it("pitches for an event (a saved plan) and a roster as combined audiences, one direction, labelled", async () => {
    const { repo } = await person("cy@sp.test");
    const plan = await runAgent({ query: "Phoebe Bridgers" }, { runId: crypto.randomUUID(), source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
    await repo.plans.create({ id: plan.runId, query: "Phoebe Bridgers", result: plan });
    const ev = done(await runRightsView(repo, { kind: "event", planId: plan.runId }, new MockQlooSource()));
    expect(ev.subject.name).toMatch(/^Phoebe Bridgers × /);
    expect(matches(ev).every((m) => m.fit.backward === null && m.fit.confidence !== "high")).toBe(true);
    expect(ev.notes.join(" ")).toMatch(/combined audience/);
    expect(matches(ev)[0].pitch.cities.length).toBeGreaterThan(0);

    const rosterId = await repo.rosters.create("Comedy");
    for (const n of ["John Mulaney", "Ali Wong"]) {
      const f = await findAct(n, undefined, new MockQlooSource(), { kind: "visitor" });
      if (f.status === "resolved") await repo.rosters.addActs(rosterId, [{ entity: f.entity }], "search");
    }
    const ro = done(await runRightsView(repo, { kind: "roster", rosterId }, new MockQlooSource()));
    expect(ro.subject.meta).toMatch(/Roster · 2 acts/);
    expect(matches(ro).length).toBeGreaterThan(0);
  });
});

describe("shortlist", () => {
  it("saves a match from the server's copy of the run, and keeps it inside the workspace", async () => {
    const a = await person("dee@sp.test");
    const b = await person("eve@sp.test");
    const r = done(await runRightsView(a.repo, { kind: "entity", query: "Phoebe Bridgers" }, new MockQlooSource()));
    const m = matches(r)[0];
    queries.length = 0;
    const id = await shortlistMatch(a.repo, r.draftId, m.key);
    const [row] = await a.repo.sponsorship.shortlist();
    expect(row).toMatchObject({ id, view: "rights", brandId: m.key });
    expect(row.pitch.fit).toEqual(m.fit);
    // Saving the same match again keeps one row.
    expect(await shortlistMatch(a.repo, r.draftId, m.key)).toBe(id);

    await expect(shortlistMatch(b.repo, r.draftId, m.key)).rejects.toBeInstanceOf(InputError);
    await expect(shortlistMatch(a.repo, r.draftId, "not-a-match")).rejects.toBeInstanceOf(InputError);
    expect(await b.repo.sponsorship.shortlist()).toEqual([]);
    await b.repo.sponsorship.remove(id);
    expect(await a.repo.sponsorship.shortlist()).toHaveLength(1);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("lets viewers read the shortlist but not run searches or save", async () => {
    const owner = await person("fay@sp.test");
    const viewer = await addUser(db, "gus@sp.test");
    const { token } = await owner.repo.invitations.create(viewer.email, "viewer");
    await unscopedAcceptInvitation(db, token, viewer);
    const repo = forWorkspace(db, { userId: viewer.id, workspaceId: owner.workspaceId, role: "viewer" });
    expect(await repo.sponsorship.shortlist()).toEqual([]);
    await expect(runBrandView(repo, { query: "Liquid Death" }, new MockQlooSource())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runRightsView(repo, { kind: "entity", query: "Clairo" }, new MockQlooSource())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
