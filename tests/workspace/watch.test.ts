import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { TENANT_TABLES } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace, unscopedUnsubscribeDigest, unscopedWatchWorkspacesDue } from "@/lib/db/unscoped";
import { readOutbox } from "@/lib/email/mailer";
import type { Candidate } from "@/lib/engine/types";
import type { WatchRefreshMessage } from "@/lib/jobs/queue";
import type { LLMProvider } from "@/lib/llm/types";
import { MockQlooSource } from "@/lib/qloo/mock";
import type { QlooSource } from "@/lib/qloo/source";
import { digestLines, sendDigests } from "@/lib/watch/digest";
import { runWatchJob } from "@/lib/watch/jobs";
import { addWatch, checkItem, FIRST_SNAPSHOT_NOTE, nextCheck, recordSnapshot, runWatchWorkspace, seededWeek, scheduleWatchJobs, watchView, WATCH_INTERVAL_MS } from "@/lib/watch/service";
import { readUnsubscribeToken, unsubscribeToken } from "@/lib/watch/token";
import { ForbiddenError } from "@/lib/workspace/permissions";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

const state = vi.hoisted(() => ({ db: null as unknown, sent: [] as WatchRefreshMessage[] }));
vi.mock("@/lib/jobs/queue", async (original) => ({
  ...(await original<typeof import("@/lib/jobs/queue")>()),
  enqueue: vi.fn(async (message: WatchRefreshMessage) => {
    state.sent.push(message);
  }),
}));
vi.mock("@/lib/workspace/session", async () => {
  const { jobContext } = await import("@/lib/workspace/context");
  return { jobWorkspace: (workspaceId: string, userId: string) => jobContext(state.db as DB, workspaceId, userId) };
});

let db: DB;
let queries: LoggedQuery[];
const MONDAY = new Date("2026-11-02T08:00:00Z");
const NEXT_MONDAY = new Date(MONDAY.getTime() + WATCH_INTERVAL_MS);
const APP = "https://takeover.test";

/** The mock, but in "week two" its partner candidates come back in reverse with lower affinity. */
function weekTwo(): QlooSource {
  const mock = new MockQlooSource();
  return new Proxy(mock, {
    get(target, prop, receiver) {
      if (prop === "candidates") {
        return async (...args: Parameters<QlooSource["candidates"]>) => {
          const res = await (target as QlooSource).candidates(...args);
          const shifted: Candidate[] = [...res.data].reverse().map((c, i) => ({ ...c, affinity: Math.max(0, c.affinity - 0.02 * i) }));
          return { ...res, data: shifted };
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function person(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  return { user, workspaceId, repo: forWorkspace(db, { userId: user.id, workspaceId, role: "owner" }) };
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

describe("market watch", () => {
  it("takes a first snapshot on adding, with no alert: one reading is not a trend", async () => {
    const { repo } = await person("amy@watch.test");
    queries.length = 0;
    const added = await addWatch(repo, { kind: "fanbase", query: "Phoebe Bridgers" }, { source: new MockQlooSource(), now: MONDAY });
    expect(added).toMatchObject({ status: "added", name: "Phoebe Bridgers", note: FIRST_SNAPSHOT_NOTE });
    const view = await watchView(repo, MONDAY);
    expect(view.items[0]).toMatchObject({ snapshots: 1, changes: 0, note: FIRST_SNAPSHOT_NOTE, nextDueAt: "2026-11-09T00:00:00.000Z" });
    expect(view.items[0].lists.map((l) => l.list).sort()).toEqual(["cities", "partners"]);
    expect(view.alerts).toEqual([]);
    const [snap] = await repo.watch.snapshots(view.items[0].id);
    expect(snap.summary.lists.partners[0]).toEqual(expect.objectContaining({ id: expect.any(String), rank: 1, value: expect.any(Number) }));
    expect(snap.qlooCalls).toBe(3);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("alerts from the second snapshot on, each alert tied to both snapshots with before and after", async () => {
    const { repo } = await person("bea@watch.test");
    const { id } = (await addWatch(repo, { kind: "fanbase", query: "Phoebe Bridgers" }, { source: new MockQlooSource(), now: MONDAY })) as { id: string };
    const item = (await repo.watch.item(id))!;
    const r = await checkItem(repo, item, { source: weekTwo(), scope: { kind: "visitor" }, now: NEXT_MONDAY });
    expect(r.first).toBe(false);
    expect(r.changes.length).toBeGreaterThan(0);
    const alerts = await repo.watch.alerts();
    expect(alerts).toHaveLength(r.changes.length);
    const [now, before] = await repo.watch.snapshots(id, 2);
    for (const a of alerts) {
      expect(a.after).toBeTruthy();
      if (a.kind !== "new") expect(a.before).toBeTruthy();
      expect(a.title).toContain(a.entityName);
    }
    const rows = await db.query.alerts.findMany();
    expect(rows.filter((x) => x.itemId === id).every((x) => x.snapshotId === now.id && x.previousSnapshotId === before.id)).toBe(true);
  });

  it("watches a city by GeoNames name and asks when the name is ambiguous", async () => {
    const { repo } = await person("cal@watch.test");
    const springfield = await addWatch(repo, { kind: "city", query: "Springfield" }, { source: new MockQlooSource(), now: MONDAY });
    expect(springfield.status).toBe("chooseCity");
    const austin = await addWatch(repo, { kind: "city", query: "Austin" }, { source: new MockQlooSource(), now: MONDAY });
    expect(austin).toMatchObject({ status: "added", name: "Austin" });
    const [snap] = await repo.watch.snapshots((austin as { id: string }).id);
    expect(Object.keys(snap.summary.lists).sort()).toEqual(["category:artist", "category:brand", "category:podcast", "category:tv_show"]);
    expect(snap.qlooCalls).toBe(4);
  });

  it("keeps watches, snapshots, alerts and digest settings inside their workspace", async () => {
    const a = await person("dan@watch.test");
    const b = await person("eli@watch.test");
    const { id } = (await addWatch(a.repo, { kind: "fanbase", query: "Phoebe Bridgers" }, { source: new MockQlooSource(), now: MONDAY })) as { id: string };
    await checkItem(a.repo, (await a.repo.watch.item(id))!, { source: weekTwo(), scope: { kind: "visitor" }, now: NEXT_MONDAY });
    await a.repo.digest.set(true);
    queries.length = 0;
    expect(await b.repo.watch.items()).toEqual([]);
    expect(await b.repo.watch.item(id)).toBeNull();
    expect(await b.repo.watch.snapshots(id)).toEqual([]);
    expect(await b.repo.watch.alerts()).toEqual([]);
    expect(await b.repo.digest.recipients()).toEqual([]);
    expect(await b.repo.watch.due(new Date("2030-01-01"))).toEqual([]);
    await b.repo.watch.remove(id);
    expect(await a.repo.watch.item(id)).not.toBeNull();
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("lets viewers read but not add watches", async () => {
    const owner = await person("fay@watch.test");
    const viewer = await addUser(db, "gus@watch.test");
    const { token } = await owner.repo.invitations.create(viewer.email, "viewer");
    await unscopedAcceptInvitation(db, token, viewer);
    const repo = forWorkspace(db, { userId: viewer.id, workspaceId: owner.workspaceId, role: "viewer" });
    await expect(addWatch(repo, { kind: "fanbase", query: "Clairo" }, { source: new MockQlooSource() })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await repo.watch.items()).toEqual([]);
  });
});

describe("two seeded snapshots", () => {
  const entry = (id: string, name: string, rank: number, value: number) => ({ id, name, rank, value });
  const week1 = {
    lists: {
      cities: [entry("c-austin", "Austin", 6, 0.7), entry("c-la", "Los Angeles", 1, 0.95), entry("c-ny", "New York City", 2, 0.9)],
      partners: [entry("p-hot", "Hot Ones", 1, 0.9), entry("p-smart", "SmartLess", 2, 0.86), entry("p-bon", "Bon Appétit", 3, 0.8)],
    },
    calls: [],
    failed: [],
  };
  const week2 = {
    lists: {
      cities: [entry("c-austin", "Austin", 2, 0.79), entry("c-la", "Los Angeles", 1, 0.95), entry("c-ny", "New York City", 3, 0.9)],
      partners: [entry("p-hot", "Hot Ones", 1, 0.82), entry("p-smart", "SmartLess", 2, 0.86), entry("p-liquid", "Liquid Death", 3, 0.91)],
    },
    calls: [],
    failed: [],
  };

  it("produce exactly the expected alerts, each with before and after values", async () => {
    const { repo } = await person("seed@watch.test");
    const { id } = await repo.watch.add({ kind: "fanbase", targetId: "e-ali", name: "Ali Wong", detail: "person", entity: { id: "e-ali", name: "Ali Wong", category: "person", popularity: 0.8 } });
    const item = (await repo.watch.item(id))!;
    const first = await recordSnapshot(repo, item, week1, { calls: 0, now: MONDAY });
    expect(first).toMatchObject({ first: true, changes: [], note: FIRST_SNAPSHOT_NOTE });
    expect(await repo.watch.alerts()).toEqual([]);

    const second = await recordSnapshot(repo, item, week2, { calls: 0, now: NEXT_MONDAY });
    const alerts = await repo.watch.alerts();
    const got = alerts.map((a) => ({ kind: a.kind, list: a.list, entity: a.entityName, before: a.before, after: a.after, title: a.title, body: a.body }));
    expect(got.sort((x, y) => x.entity.localeCompare(y.entity))).toEqual([
      {
        kind: "rank_up",
        list: "cities",
        entity: "Austin",
        before: { rank: 6, value: 0.7 },
        after: { rank: 2, value: 0.79 },
        title: "Austin up 4 places in the top cities for Ali Wong",
        body: "Rank #6 → #2; Qloo value 70 → 79 among Ali Wong fans.",
      },
      {
        kind: "value_down",
        list: "partners",
        entity: "Hot Ones",
        before: { rank: 1, value: 0.9 },
        after: { rank: 1, value: 0.82 },
        title: "Ali Wong fans cooling on Hot Ones",
        body: "Down 8 points, 90 → 82; still #1 in the top crossover partners.",
      },
      {
        kind: "new",
        list: "partners",
        entity: "Liquid Death",
        before: null,
        after: { rank: 3, value: 0.91 },
        title: "Liquid Death entered the top crossover partners for Ali Wong",
        body: "Now #3 at 91 / 100; it was not in the top list last week.",
      },
    ]);
    // Los Angeles (no change), New York City (one place, under 3) and SmartLess (no change) stay quiet.
    expect(second.note).toBe("3 changes since last week.");
    const [now, before] = await repo.watch.snapshots(id, 2);
    const rows = (await db.query.alerts.findMany()).filter((a) => a.itemId === id);
    expect(rows.every((a) => a.snapshotId === now.id && a.previousSnapshotId === before.id)).toBe(true);
  });

  it("the seeded next week used for local checks gives one rise and one fall per list", () => {
    const s = { lists: { partners: [entry("a", "A", 1, 0.9), entry("b", "B", 2, 0.88), entry("c", "C", 3, 0.85), entry("d", "D", 4, 0.8)] } };
    const next = seededWeek(s);
    expect(next.lists.partners.map((e) => [e.id, e.rank])).toEqual([["d", 1], ["a", 2], ["b", 3], ["c", 4]]);
    expect(next.lists.partners.find((e) => e.id === "b")!.value).toBeCloseTo(0.8);
  });

  it("sends each recipient the digest in the look they picked", async () => {
    const { repo, user } = await person("look@watch.test");
    const { id } = await repo.watch.add({ kind: "fanbase", targetId: "e-ali2", name: "Ali Wong", detail: "person", entity: { id: "e-ali2", name: "Ali Wong", category: "person", popularity: 0.8 } });
    const item = (await repo.watch.item(id))!;
    await recordSnapshot(repo, item, week1, { calls: 0, now: MONDAY });
    await recordSnapshot(repo, item, week2, { calls: 0, now: NEXT_MONDAY });
    await repo.digest.setTheme("dark");
    expect((await repo.digest.get())?.enabled).toBe(false);
    await repo.digest.set(true);
    await sendDigests(repo, { workspaceName: "W", appUrl: APP, now: NEXT_MONDAY });
    const [mail] = readOutbox(user.email);
    expect(mail.html).toContain('bgcolor="#161826"');
    expect(mail.html).toContain("Austin up 4 places");
  });
});

describe("weekly job", () => {
  it("is due at the next Monday at least four days away", () => {
    expect(nextCheck(new Date("2026-10-28T15:00:00Z")).toISOString()).toBe("2026-11-02T00:00:00.000Z"); // Wednesday → Monday
    expect(nextCheck(new Date("2026-11-01T15:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z"); // Sunday → a week later
    expect(nextCheck(new Date("2026-11-02T07:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z"); // Monday's run → next Monday
  });

  it("checks due items through the queue, one job per workspace, and records it", async () => {
    const { repo, workspaceId } = await person("hal@watch.test");
    await addWatch(repo, { kind: "fanbase", query: "Phoebe Bridgers" }, { source: new MockQlooSource(), now: MONDAY });
    expect((await unscopedWatchWorkspacesDue(db, MONDAY)).some((d) => d.workspaceId === workspaceId)).toBe(false);
    const due = (await unscopedWatchWorkspacesDue(db, NEXT_MONDAY)).filter((d) => d.workspaceId === workspaceId);
    expect(due).toHaveLength(1);
    await scheduleWatchJobs(due, NEXT_MONDAY);
    expect(state.sent).toEqual([{ kind: "watch.refresh", workspaceId, userId: due[0].userId, asOf: NEXT_MONDAY.toISOString() }]);
    await runWatchJob(state.sent[0]);
    const [job] = await repo.jobs.listFor(workspaceId);
    expect(job).toMatchObject({ kind: "watch.refresh", status: "done" });
    expect(job.note).toMatch(/Checked 1 of 1/);
    expect((await repo.watch.snapshots((await repo.watch.items())[0].id, 5)).length).toBe(2);
  });

  it("skips and logs items that would go over the workspace allowance, until next month", async () => {
    vi.stubEnv("QLOO_WORKSPACE_MONTHLY_CALLS", "2");
    const { repo } = await person("ivy@watch.test");
    const added = await addWatch(repo, { kind: "fanbase", query: "Phoebe Bridgers" }, { source: new MockQlooSource(), now: MONDAY });
    // Not enough left even for the first snapshot: it waits, and says so.
    expect(added).toMatchObject({ status: "added" });
    expect((added as { note: string }).note).toMatch(/waits for Monday's check/);
    const r = await runWatchWorkspace(repo, { source: new MockQlooSource(), now: NEXT_MONDAY, workspaceName: "W", appUrl: APP });
    expect(r).toMatchObject({ checked: 0, skipped: 1, calls: 0 });
    expect(r.note).toMatch(/skipped: budget/);
    const [item] = await repo.watch.items();
    expect(item.lastNote).toMatch(/^Skipped: this workspace's monthly Qloo allowance was reached\. Checked again from 2026-12-01\./);
    expect(item.nextDueAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(await repo.watch.snapshots(item.id)).toEqual([]);
  });

  it("keeps the daily job reserve for people", async () => {
    vi.stubEnv("QLOO_DAILY_CALL_CAP", "10");
    vi.stubEnv("QLOO_JOB_RESERVE", "9");
    const { repo } = await person("jay@watch.test");
    await repo.watch.add({ kind: "city", targetId: "4671654", name: "Austin", detail: "US" });
    const r = await runWatchWorkspace(repo, { source: new MockQlooSource(), now: NEXT_MONDAY, workspaceName: "W", appUrl: APP });
    expect(r.skipped).toBe(1);
    expect((await repo.watch.items())[0].lastNote).toMatch(/share of today's Qloo cap kept for people/);
  });
});

describe("weekly digest", () => {
  async function workspaceWithChanges(email: string) {
    const owner = await person(email);
    const { id } = (await addWatch(owner.repo, { kind: "fanbase", query: "Phoebe Bridgers" }, { source: new MockQlooSource(), now: MONDAY })) as { id: string };
    await checkItem(owner.repo, (await owner.repo.watch.item(id))!, { source: weekTwo(), scope: { kind: "visitor" }, now: NEXT_MONDAY });
    const member = await addUser(db, `m.${email}`);
    const { token } = await owner.repo.invitations.create(member.email, "member");
    await unscopedAcceptInvitation(db, token, member);
    return { owner, member, memberRepo: forWorkspace(db, { userId: member.id, workspaceId: owner.workspaceId, role: "member" }) };
  }

  it("goes only to members who turned it on, with an unsubscribe link and header", async () => {
    const { owner, member, memberRepo } = await workspaceWithChanges("kim@watch.test");
    await memberRepo.digest.set(true);
    const sent = await sendDigests(owner.repo, { workspaceName: "Kim's", appUrl: APP, now: NEXT_MONDAY });
    expect(sent).toEqual([member.id]);
    expect(readOutbox(owner.user.email!)).toEqual([]);
    const [mail] = readOutbox(member.email);
    expect(mail.subject).toMatch(/^Market watch · week of 9 Nov · \d+ changes?$/);
    expect(mail.text).toContain(`${APP}/unsubscribe/digest?token=`);
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(new RegExp(`^<${APP}/api/digest/unsubscribe\\?token=`));
    const alerts = await owner.repo.watch.alerts();
    for (const a of alerts.slice(0, 3)) expect(mail.text).toContain(a.title);
  });

  it("sends nothing in a week with no changes, and nothing to a member who turned it off", async () => {
    const { owner, memberRepo } = await workspaceWithChanges("lee@watch.test");
    await memberRepo.digest.set(true);
    await memberRepo.digest.set(false);
    expect(await sendDigests(owner.repo, { workspaceName: "W", appUrl: APP, now: NEXT_MONDAY })).toEqual([]);
    await owner.repo.digest.set(true);
    const later = new Date(NEXT_MONDAY.getTime() + 2 * WATCH_INTERVAL_MS);
    expect(await sendDigests(owner.repo, { workspaceName: "W", appUrl: APP, now: later })).toEqual([]);
  });

  it("unsubscribes with the link's token, without signing in; a tampered token does nothing", async () => {
    const { owner, member, memberRepo } = await workspaceWithChanges("max@watch.test");
    await memberRepo.digest.set(true);
    const token = unsubscribeToken(owner.workspaceId, member.id);
    expect(readUnsubscribeToken(`${token}x`)).toBeNull();
    expect(readUnsubscribeToken(token.replace(/^./, "A"))).toBeNull();
    const who = readUnsubscribeToken(token)!;
    expect(who).toEqual({ workspaceId: owner.workspaceId, userId: member.id });
    expect(await unscopedUnsubscribeDigest(db, who.workspaceId, who.userId)).toBe(true);
    expect((await memberRepo.digest.get())?.enabled).toBe(false);
    expect(await sendDigests(owner.repo, { workspaceName: "W", appUrl: APP, now: NEXT_MONDAY })).toEqual([]);
  });

  it("lets the model rephrase lines but never add a fact", async () => {
    const { owner } = await workspaceWithChanges("ned@watch.test");
    const alerts = await owner.repo.watch.alerts();
    const model = { name: "gemini", model: "fake", chat: () => ({ send: async () => ({ stopReason: "end_turn", text: "", calls: [], usage: { input: 0, output: 0 } }) }), complete: async () => ({ text: "Up 40% since 2025, a record.", refused: false, usage: { input: 1, output: 1 } }) } as unknown as LLMProvider;
    const lines = await digestLines(alerts, model);
    expect(lines.map((l) => l.body)).toEqual(alerts.map((a) => a.body));
  });
});
