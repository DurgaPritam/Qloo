import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DB } from "@/lib/db";
import { forWorkspace, InputError } from "@/lib/db/scoped";
import { memberships, TENANT_TABLES, workspaces } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { scoreRosterPairs } from "@/lib/engine/roster";
import type { RosterRefreshMessage } from "@/lib/jobs/queue";
import { BudgetExceededError } from "@/lib/qloo/errors";
import { MockQlooSource } from "@/lib/qloo/mock";
import type { QlooSource } from "@/lib/qloo/source";
import { runRosterJob } from "@/lib/roster/jobs";
import { findAct, resolveImport } from "@/lib/roster/resolve";
import { profileKey, rosterView, runBatch, startRefresh } from "@/lib/roster/service";
import { metroPool } from "@/lib/tools/shared";
import { ForbiddenError } from "@/lib/workspace/permissions";
import { and, eq } from "drizzle-orm";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

/** The job queue and the session are replaced: jobs are captured, and run against this test's database. */
const state = vi.hoisted(() => ({ db: null as unknown, sent: [] as RosterRefreshMessage[] }));
vi.mock("@/lib/jobs/queue", async (original) => ({
  ...(await original<typeof import("@/lib/jobs/queue")>()),
  enqueue: vi.fn(async (message: RosterRefreshMessage) => {
    state.sent.push(message);
  }),
}));
vi.mock("@/lib/workspace/session", async () => {
  const { jobContext } = await import("@/lib/workspace/context");
  return { jobWorkspace: (workspaceId: string, userId: string) => jobContext(state.db as DB, workspaceId, userId) };
});

let db: DB;
let queries: LoggedQuery[];
const source = new MockQlooSource();
const scope = { kind: "visitor" as const };

async function person(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  await db.update(workspaces).set({ tier: "team" }).where(eq(workspaces.id, workspaceId));
  return { user, workspaceId, repo: forWorkspace(db, { userId: user.id, workspaceId, role: "owner" }) };
}

async function entity(name: string) {
  const found = await findAct(name, undefined, source, scope);
  if (found.status !== "resolved") throw new Error(`mock did not resolve ${name}`);
  return found.entity;
}

/** Fresh act names per test: profiles are cached per entity across workspaces, as in production. */
const actNames = (tag: string, n: number) => Array.from({ length: n }, (_, i) => `${tag} act ${i + 1}`);

async function rosterWith(repo: ReturnType<typeof forWorkspace>, names: string[]) {
  const id = await repo.rosters.create("North Star comedy");
  await repo.rosters.addActs(id, await Promise.all(names.map(async (n) => ({ entity: await entity(n) }))), "search");
  return id;
}

beforeAll(async () => {
  ({ db, queries } = await testDb());
  state.db = db;
});

beforeEach(() => {
  queries.length = 0;
  state.sent.length = 0;
  vi.stubEnv("TAKEOVER_MOCK", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("roster scoping", () => {
  it("keeps a workspace's rosters, acts and jobs away from every other workspace", async () => {
    const a = await person("ana@a.test");
    const b = await person("ben@b.test");
    queries.length = 0;
    const id = await rosterWith(a.repo, actNames("scope", 2));
    await startRefresh(a.repo, id, { force: false });

    expect(await b.repo.rosters.list()).toEqual([]);
    expect(await b.repo.rosters.get(id)).toBeNull();
    expect(await b.repo.rosters.acts(id)).toEqual([]);
    expect(await b.repo.jobs.listFor(id)).toEqual([]);
    expect(await rosterView(b.repo, id)).toBeNull();
    await expect(b.repo.rosters.addActs(id, [{ entity: await entity("Clairo") }], "search")).rejects.toBeInstanceOf(InputError);
    const [act] = await a.repo.rosters.acts(id);
    await b.repo.rosters.removeAct(id, act.id);
    await b.repo.rosters.remove(id);
    expect(await a.repo.rosters.acts(id)).toHaveLength(2);
    await expect(startRefresh(b.repo, id, { force: true })).rejects.toBeInstanceOf(InputError);

    expectAllScoped(queries, TENANT_TABLES);
  });

  it("lets viewers read rosters but not change or refresh them", async () => {
    const owner = await person("olu@c.test");
    const viewer = await addUser(db, "vic@c.test");
    const { token } = await owner.repo.invitations.create(viewer.email, "viewer");
    expect((await unscopedAcceptInvitation(db, token, viewer)).ok).toBe(true);
    const repo = forWorkspace(db, { userId: viewer.id, workspaceId: owner.workspaceId, role: "viewer" });
    queries.length = 0;
    const id = await rosterWith(owner.repo, actNames("viewer", 1));

    expect((await repo.rosters.list()).map((r) => r.id)).toEqual([id]);
    expect((await rosterView(repo, id))?.canEdit).toBe(false);
    await expect(repo.rosters.create("Mine")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(repo.rosters.addActs(id, [{ entity: await entity("Clairo") }], "search")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startRefresh(repo, id, { force: false })).rejects.toBeInstanceOf(ForbiddenError);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("refuses duplicates (the tier's roster size is checked by the routes: tests/workspace/entitlements.test.ts)", async () => {
    const { repo } = await person("dee@d.test");
    const id = await rosterWith(repo, ["Phoebe Bridgers"]);
    expect(await repo.rosters.addActs(id, [{ entity: await entity("Phoebe Bridgers") }], "search")).toEqual({ added: [], already: 1 });
  });
});

describe("roster refresh", () => {
  it("scores every act and pair with engine code, and reuses them for a week", async () => {
    const { repo } = await person("eve@e.test");
    const id = await rosterWith(repo, actNames("fresh", 3));
    const before = await rosterView(repo, id);
    expect(before?.pairs).toEqual([]);
    expect(before?.pendingPairs).toBe(3);
    expect(before?.estimate.stale.calls).toBeGreaterThan(0);

    const outcome = await startRefresh(repo, id, { force: false });
    expect(outcome.status).toBe("done");

    const view = (await rosterView(repo, id))!;
    expect(view.acts.every((a) => a.profile && !a.stale)).toBe(true);
    expect(view.acts.every((a) => a.profile!.mock)).toBe(true);
    expect(view.pairs).toHaveLength(3);
    expect(view.pendingPairs).toBe(0);
    expect(view.jobs.map((j) => j.status)).toEqual(["done"]);

    // The page shows exactly what the engine computes from the stored Qloo answers.
    const acts = await repo.rosters.acts(id);
    const profiles = new Map((await repo.entityProfiles.get(acts.map((a) => profileKey(a.qlooEntityId, true)))).map((p) => [p.entityId, p.profile]));
    const engine = scoreRosterPairs(
      acts.map((a) => ({
        id: a.qlooEntityId,
        name: a.name,
        category: a.type,
        affinities: a.affinities ?? {},
        market: profiles.get(a.qlooEntityId)?.market,
        heat: new Map(Object.entries(profiles.get(a.qlooEntityId)?.heat ?? {}).map(([k, [mean, cells]]) => [k, { mean, cells }])),
      })),
      metroPool(),
    );
    expect(view.pairs).toEqual(engine.pairs);

    expect((await startRefresh(repo, id, { force: false })).status).toBe("fresh");
    expect(view.estimate.stale.calls).toBe(0);
    expect(view.estimate.all.calls).toBeGreaterThan(0);
  });

  it("a 10-act roster: full matrix, ranked pairings, estimate equals calls made, every score has its evidence", async () => {
    const { repo } = await person("ten@t.test");
    // One person among artists, so pairings need two categories for some acts.
    const id = await rosterWith(repo, ["John Mulaney", ...actNames("ten", 9)]);
    const before = (await rosterView(repo, id))!;
    const outcome = await startRefresh(repo, id, { force: true });
    expect(outcome.status).toBe("queued");
    for (const message of state.sent) await runRosterJob(message);

    const view = (await rosterView(repo, id))!;
    expect(view.acts).toHaveLength(10);
    expect(view.pairs).toHaveLength(45);
    expect(view.pendingPairs + view.unscored.length).toBe(0);
    expect(view.pairs.map((p) => p.rank)).toEqual(view.pairs.map((_, i) => i + 1));
    for (let i = 1; i < view.pairs.length; i++) expect(view.pairs[i - 1].score).toBeGreaterThanOrEqual(view.pairs[i].score);

    // Cold cache and a forced refresh: every planned call is made, no more, no fewer.
    const used = view.jobs.reduce((n, j) => n + j.qlooCalls, 0);
    expect(view.jobs.map((j) => j.status).every((s) => s === "done")).toBe(true);
    expect(view.jobs.reduce((n, j) => n + (j.estimate ?? 0), 0)).toBe(before.estimate.all.calls);
    expect(used).toBe(before.estimate.all.calls);

    // Each pair's score comes from Qloo answers recorded with the requests that produced them.
    for (const p of view.pairs) {
      const a = view.acts.find((x) => x.entityId === p.a.id)!;
      const b = view.acts.find((x) => x.entityId === p.b.id)!;
      const asked = (from: typeof a, to: string) => from.pairingCalls.some((c) => c.params["filter.results.entities"].split(",").includes(to) && c.params["signal.interests.entities"] === from.entityId);
      expect(asked(a, b.entityId) && asked(b, a.entityId)).toBe(true);
      expect(p.evidence.bAmongA).not.toBeNull();
      expect(p.evidence.aAmongB).not.toBeNull();
    }
    // Each act's picks carry their Qloo values and the requests behind them.
    for (const a of view.acts) {
      expect(a.profile!.calls!.length).toBe(4);
      if (a.profile!.partner) expect(a.profile!.partner.evidence).toBeDefined();
      if (a.profile!.sponsor) expect(a.profile!.sponsor.evidence).toBeDefined();
      if (a.profile!.city) expect(a.profile!.city.evidence!.cells).toBeGreaterThan(0);
    }
  });

  it("blocks a refresh that would exceed the workspace allowance, before any call", async () => {
    vi.stubEnv("QLOO_WORKSPACE_MONTHLY_CALLS", "5");
    const { repo } = await person("fay@f.test");
    const id = await rosterWith(repo, actNames("blocked", 2));
    const outcome = await startRefresh(repo, id, { force: false });
    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.message).toMatch(/up to 10 Qloo calls.*5 of 5 left/);
    expect(await repo.jobs.listFor(id)).toEqual([]);
    expect((await rosterView(repo, id))!.acts.every((a) => !a.profile)).toBe(true);
  });

  it("stops a batch when a budget runs out, keeps what was done and says what was skipped", async () => {
    const { repo } = await person("gus@g.test");
    const id = await rosterWith(repo, actNames("budget", 3));
    let calls = 0;
    const limited = new Proxy(source, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (++calls > 5) throw new BudgetExceededError({ endpoint: "/v2/insights", params: {}, runId: "r", limit: 5, limitName: "workspace" });
          return value.apply(target, args);
        };
      },
    }) as QlooSource;
    const acts = await repo.rosters.acts(id);
    const units = acts.map((a) => ({ actId: a.id, profile: true, pairings: [], calls: 4 }));
    const result = await runBatch(repo, id, units, { source: limited, scope: { kind: "workspace", workspaceId: repo.context.workspaceId }, fresh: false });
    expect(result.budget?.limitName).toBe("workspace");
    expect(result.profiled).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it("staggers a large roster through the job queue, one job per batch, and each job records its outcome", async () => {
    const { repo } = await person("hal@h.test");
    queries.length = 0;
    const id = await rosterWith(repo, actNames("large", 6));
    const outcome = await startRefresh(repo, id, { force: false });
    expect(outcome.status).toBe("queued");
    if (outcome.status !== "queued") return;
    expect(outcome.batches).toBeGreaterThan(1);
    expect(state.sent).toHaveLength(outcome.batches);
    expect(state.sent.every((m) => m.workspaceId === repo.context.workspaceId && m.rosterId === id)).toBe(true);
    expect((await rosterView(repo, id))!.jobs.every((j) => j.status === "queued")).toBe(true);

    expectAllScoped(queries, TENANT_TABLES);

    for (const message of state.sent) await runRosterJob(message);
    // A redelivered message does nothing the second time.
    await runRosterJob(state.sent[0]);
    // Jobs find their workspace through the requester's memberships (a named unscoped lookup).
    queries.length = 0;
    const view = (await rosterView(repo, id))!;
    expect(view.jobs.map((j) => j.status)).toEqual(view.jobs.map(() => "done"));
    expect(view.pairs).toHaveLength(15);
    expect(view.acts.every((a) => a.profile)).toBe(true);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("does nothing for a job whose requester has left the workspace", async () => {
    const owner = await person("ida@i.test");
    const member = await addUser(db, "jo@i.test");
    const { token } = await owner.repo.invitations.create(member.email, "member");
    await unscopedAcceptInvitation(db, token, member);
    const repo = forWorkspace(db, { userId: member.id, workspaceId: owner.workspaceId, role: "member" });
    const id = await rosterWith(owner.repo, actNames("left", 6));
    expect((await startRefresh(repo, id, { force: false })).status).toBe("queued");
    await db.delete(memberships).where(and(eq(memberships.workspaceId, owner.workspaceId), eq(memberships.userId, member.id)));
    await runRosterJob(state.sent[0]);
    expect((await owner.repo.jobs.get(state.sent[0].jobId))?.status).toBe("queued");
  });
});

describe("roster CSV import", () => {
  it("adds names that resolve and returns ambiguous and unknown ones for matching by hand", async () => {
    const { repo } = await person("kai@k.test");
    queries.length = 0;
    const id = await repo.rosters.create("Imported");
    const rows = [
      { row: 2, name: "Phoebe Bridgers", homeCity: "Los Angeles" },
      { row: 3, name: "Mercury" },
      { row: 4, name: "Zzxq" },
    ];
    const { resolved, unresolved } = await resolveImport(rows, source, scope);
    expect(resolved.map((r) => r.entity.name)).toEqual(["Phoebe Bridgers"]);
    expect(unresolved.map((u) => [u.row, u.name, u.choices.length > 0])).toEqual([
      [3, "Mercury", true],
      [4, "Zzxq", false],
    ]);
    expect(unresolved[1].reason).toMatch(/no entity matching/);

    await repo.rosters.addActs(id, resolved.map((r) => ({ entity: r.entity, homeCity: r.homeCity })), "csv");
    // Matching by hand: the user picks one of the choices.
    const picked = await findAct("Mercury", unresolved[0].choices[1].entityId, source, scope);
    expect(picked.status).toBe("resolved");
    if (picked.status === "resolved") await repo.rosters.addActs(id, [{ entity: picked.entity }], "search");

    const view = (await rosterView(repo, id))!;
    expect(view.acts.map((a) => [a.name, a.homeCity])).toEqual([
      ["Phoebe Bridgers", "Los Angeles"],
      [unresolved[0].choices[1].name, null],
    ]);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("stops searching once a budget is reached and says so for the rest", async () => {
    const failing = new Proxy(source, {
      get(target, prop, receiver) {
        if (prop === "searchEntities") return () => Promise.reject(new BudgetExceededError({ endpoint: "/search", params: {}, runId: "r", limit: 1, limitName: "workspace" }));
        return Reflect.get(target, prop, receiver);
      },
    }) as QlooSource;
    const { resolved, unresolved } = await resolveImport([{ row: 1, name: "A" }, { row: 2, name: "B" }], failing, scope);
    expect(resolved).toEqual([]);
    expect(unresolved.every((u) => /monthly Qloo allowance/.test(u.reason))).toBe(true);
  });
});
