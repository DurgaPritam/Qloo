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

import { buildDeck } from "@/components/run/exports";
import { pitchFooter, pitchNumbers, pitchOutline } from "@/lib/export/sponsor";

import { addUser, testDb } from "../support/db";
import { openPptx } from "../support/pptx";
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

describe("done when: a brand and a team, and a deck that opens with every figure traced", () => {
  const evidenced = (m: ReturnType<typeof matches>[number]) => {
    expect(m.fit.evidence.filter((e) => e.source === "qloo").length).toBeGreaterThan(0);
    for (const e of m.fit.evidence.filter((x) => x.source === "qloo")) expect(e.text).toContain(e.value!.toFixed(2));
    expect(m.fit.evidence.at(-1)!.kind).toBe("to_confirm");
  };

  it("a brand: a ranked list of talent, each fit traced to the two Qloo requests behind it", async () => {
    const { repo } = await person("hal@sp.test");
    const r = done(await runBrandView(repo, { query: "Liquid Death" }, new MockQlooSource()));
    expect(r.subject.name).toBe("Liquid Death");
    const all = matches(r);
    expect(all.map((m) => m.fit.fit)).toEqual([...all.map((m) => m.fit.fit)].sort((a, b) => b - a));
    for (const m of all) {
      evidenced(m);
      const figures = (m.pitch.sources ?? []).map((s) => s.figure);
      expect(figures).toEqual([
        `Liquid Death among ${m.name} fans (fit, forward)`,
        `${m.name} among Liquid Death fans (fit, backward)`,
        "Cities: Liquid Death fans' heat",
        "Audience: Liquid Death fans",
      ]);
      const forward = m.pitch.sources![0];
      expect(forward.params["filter.results.entities"]).toBe("mock:seed:liquid-death:brand");
      expect(forward.params["filter.type"]).toBe("urn:entity:brand");
    }
  });

  it("a team: a ranked list of brands to pitch, no rival teams, each fit traced both ways", async () => {
    const { repo } = await person("ivy@sp.test");
    const r = done(await runRightsView(repo, { kind: "entity", query: "Golden State Warriors" }, withRivals()));
    expect(r.subject.name).toBe("Golden State Warriors");
    const all = matches(r);
    expect(all.length).toBeGreaterThan(0);
    expect(all.map((m) => m.name)).not.toContain("Rival F.C.");
    for (const g of r.groups) expect(g.matches.map((m) => m.fit.fit)).toEqual([...g.matches.map((m) => m.fit.fit)].sort((a, b) => b - a));
    for (const m of all) {
      evidenced(m);
      const [forward, backward] = m.pitch.sources!;
      expect(forward.params["signal.interests.entities"]).toBe("mock:seed:golden-state-warriors:brand");
      if (m.fit.backward !== null) {
        expect(backward.figure).toMatch(/fit, backward/);
        expect(backward.params["filter.results.entities"]).toBe("mock:seed:golden-state-warriors:brand");
        expect(backward.params["signal.interests.entities"]).toBe(m.key);
      }
    }
  });

  it("pitches one act from a roster on its own, from its stored entity, with no search call", async () => {
    const { repo } = await person("kai@sp.test");
    const roster = await repo.rosters.create("Comedy clients");
    const found = await findAct("Ali Wong", undefined, new MockQlooSource(), { kind: "visitor" });
    if (found.status !== "resolved") throw new Error("mock should resolve Ali Wong");
    await repo.rosters.addActs(roster, [{ entity: found.entity }], "search");
    const [act] = await repo.rosters.acts(roster);
    const source = new MockQlooSource();
    const spy = vi.spyOn(source, "searchEntities");
    const r = done(await runRightsView(repo, { kind: "roster", rosterId: roster, actId: act.id }, source));
    expect(spy).not.toHaveBeenCalled();
    expect(r.subject.name).toBe("Ali Wong");
    expect(r.subject.meta).toMatch(/· from Comedy clients/);
    const solo = done(await runRightsView(repo, { kind: "entity", query: "Ali Wong", entityId: found.entity.id }, new MockQlooSource()));
    expect(matches(r).map((m) => [m.key, m.fit.fit])).toEqual(matches(solo).map((m) => [m.key, m.fit.fit]));
    await expect(runRightsView(repo, { kind: "roster", rosterId: roster, actId: crypto.randomUUID() }, new MockQlooSource())).rejects.toBeInstanceOf(InputError);
  });

  it("shows the workspace's saved plans as events in the brand view, one direction each, and they can be shortlisted", async () => {
    const { repo } = await person("lea@sp.test");
    const id = crypto.randomUUID();
    const plan = await runAgent({ query: "Phoebe Bridgers" }, { runId: id, source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
    await repo.plans.create({ id, query: "Phoebe Bridgers", result: plan });
    const r = done(await runBrandView(repo, { query: "Liquid Death" }, new MockQlooSource()));
    expect(r.calls).toBeLessThanOrEqual(17);
    const event = r.groups.find((g) => g.label === "Your events")!.matches[0];
    const partner = plan.partners!.picks.find((p) => p.pick.entity.id === plan.partners!.chosenId)!.pick.entity;
    expect(event).toMatchObject({ key: `event:${id}`, kind: "Event", name: `Phoebe Bridgers × ${partner.name}` });
    expect(event.fit.backward).toBeNull();
    expect(event.fit.confidence).not.toBe("high");
    expect(event.pitch.sources![0].params["signal.interests.entities"]).toContain(plan.fanbase!.id);
    const saved = await shortlistMatch(repo, r.draftId, event.key);
    const [row] = (await repo.sponsorship.shortlist()).filter((x) => x.id === saved);
    expect(row.holderKey).toBe([plan.fanbase!.id, partner.id].sort((a, b) => a.localeCompare(b)).join(","));
  });

  it("adds a labelled local fallback when fewer than 3 brands pass the filters, from the home city in Qloo's description", async () => {
    const { repo } = await person("thin@sp.test");
    const mock = new MockQlooSource();
    const cities: (string | undefined)[] = [];
    const thin = new Proxy(mock, {
      get(target, prop, receiver) {
        if (prop === "searchEntities") {
          return async (...args: Parameters<QlooSource["searchEntities"]>) => {
            const res = await (target as QlooSource).searchEntities(...args);
            return { ...res, data: res.data.map((e) => ({ ...e, description: "A professional basketball team based in San Francisco, known for its play." })) };
          };
        }
        if (prop === "brands") {
          return async (...args: Parameters<QlooSource["brands"]>) => {
            const res = await (target as QlooSource).brands(...args);
            cities.push(args[1]);
            // Nationally only one real brand survives (the rest are teams); locally there are more.
            return args[1] ? res : { ...res, data: [res.data[0], { id: "rival", name: "Rival F.C.", affinity: 0.99, popularity: 0.9, tags: ["Sports Organization"] }] };
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const r = done(await runRightsView(repo, { kind: "entity", query: "Golden State Warriors" }, thin));
    expect(cities).toContain("San Francisco");
    const fallback = r.groups.find((g) => g.label.startsWith("Fallback"))!;
    expect(fallback.label).toBe("Fallback · brands Golden State Warriors fans over-index on in San Francisco");
    expect(fallback.matches.length).toBeGreaterThan(0);
    const main = r.groups.filter((g) => g !== fallback).flatMap((g) => g.matches);
    expect(main.length).toBeLessThan(3);
    for (const m of fallback.matches) {
      expect(m.meta).toMatch(/its home city in Qloo's description/);
      expect(m.fit.backward).toBeNull();
      expect(main.map((x) => x.key)).not.toContain(m.key);
      expect(m.pitch.sources![0].params["signal.location.query"] ?? m.pitch.sources![0].params["filter.location.query"]).toBe("San Francisco");
    }
    expect(r.calls).toBeLessThanOrEqual(10);
  });

  it("adds this week's Market watch lines when the workspace watches the act or a city where the brand ranks", async () => {
    const { repo } = await person("joy@sp.test");
    const first = done(await runRightsView(repo, { kind: "entity", query: "Golden State Warriors" }, new MockQlooSource()));
    expect(matches(first).every((m) => m.thisWeek.length === 0)).toBe(true);
    const brand = matches(first)[0];
    const act = "mock:seed:golden-state-warriors:brand";

    const now = new Date();
    const city = await repo.watch.add({ kind: "city", targetId: "4887398", name: "Chicago", detail: "US" });
    const fan = await repo.watch.add({ kind: "fanbase", targetId: act, name: "Golden State Warriors", detail: "brand" });
    const lists = { "category:brand": [{ id: brand.key, name: brand.name, rank: 2, value: 0.7 }] };
    const prev = await repo.watch.addSnapshot(fan.id, { lists: {}, calls: [] }, 0, new Date(now.getTime() - 7 * 86_400_000));
    const curr = await repo.watch.addSnapshot(fan.id, { lists: {}, calls: [] }, 0, now);
    await repo.watch.addSnapshot(city.id, { lists, calls: [] }, 0, now);
    await repo.watch.setChecked(city.id, { lastSnapshotAt: now, lastNote: null });
    await repo.watch.addAlerts([
      { itemId: fan.id, snapshotId: curr, previousSnapshotId: prev, kind: "rank_up", list: "cities", entityId: "geo-1", entityName: "Oakland", before: { rank: 6, value: 0.5 }, after: { rank: 2, value: 0.8 }, title: "Oakland up 4 places in the top cities for Golden State Warriors", body: "", createdAt: now },
    ]);

    queries.length = 0;
    const again = done(await runRightsView(repo, { kind: "entity", query: "Golden State Warriors" }, new MockQlooSource()));
    const m = matches(again).find((x) => x.key === brand.key)!;
    expect(m.thisWeek.map((l) => l.text)).toEqual([
      "Oakland up 4 places in the top cities for Golden State Warriors",
      `${brand.name} is #2 in the top brands in Chicago (Market watch, latest reading).`,
    ]);
    expect(m.fit).toEqual(brand.fit);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("the pitch deck is a real .pptx that opens, with every number traceable to Qloo or the engine", async () => {
    const { repo } = await person("jo@sp.test");
    const r = done(await runRightsView(repo, { kind: "entity", query: "Golden State Warriors" }, new MockQlooSource()));
    const pitch = matches(r)[0].pitch;
    const outline = pitchOutline(pitch);
    expect(outline.at(-1)!.title).toBe("Sources");
    const pptx = await buildDeck(outline, { title: `${pitch.holder} × ${pitch.brand}`, footer: pitchFooter(pitch), mock: pitch.mock });
    const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
    const { files, slides } = openPptx(bytes);
    expect(files).toEqual(expect.arrayContaining(["[Content_Types].xml", "ppt/presentation.xml"]));
    expect(slides).toHaveLength(outline.length);
    const allowed = pitchNumbers(pitch);
    slides.forEach((runs, i) => {
      const text = runs.join(" ");
      expect(text).toContain(outline[i].title.toUpperCase());
      for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) {
        // The slide number in the corner is the only number the deck adds.
        if (n === String(i + 1)) continue;
        expect(allowed.has(n), `slide ${i + 1}: ${n} is not from Qloo or the engine`).toBe(true);
      }
    });
    expect(slides.flat().join(" ")).toContain(`${pitch.fit.fit} / 100`);
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
