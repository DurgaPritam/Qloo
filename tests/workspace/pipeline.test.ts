import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Plan } from "@/lib/agent/types";
import type { DB } from "@/lib/db";
import { forWorkspace, InputError } from "@/lib/db/scoped";
import { TENANT_TABLES } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { scoreSponsorFit } from "@/lib/engine/sponsor";
import { cardFromMatch, cardsFromPlan, contentHash } from "@/lib/pipeline/drafts";
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

const pitch = (holder: string, brand: string) => ({
  holder,
  brand,
  sector: "Beverages",
  fit: scoreSponsorFit({ name: holder }, { name: brand }, { forward: 0.82, backward: 0.64 })!,
  audience: null,
  cities: [{ name: "Chicago", score: 0.9 }],
  mock: true,
});

beforeAll(async () => {
  ({ db, queries } = await testDb());
  template = await runAgent({ query: "Phoebe Bridgers" }, { runId: "t", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
});
beforeEach(() => {
  queries.length = 0;
});

describe("cards come from what Takeover already wrote", () => {
  it("a plan gives its partner and venue emails, unchanged", () => {
    const cards = cardsFromPlan("p1", template);
    expect(cards.map((c) => c.kind)).toEqual(["partner", "venue"]);
    expect(cards[0]).toMatchObject({ sourceKey: "plan:p1:partner", subject: template.outreach![0].subject, body: template.outreach![0].body });
    expect(cards[0].context).toContain(template.fanbase!.name);
  });

  it("a sponsor draft carries no figures: commercial terms stay to confirm", () => {
    const card = cardFromMatch("m1", pitch("Fred again..", "Liquid Death"));
    expect(card.kind).toBe("sponsor");
    expect(`${card.subject} ${card.body}`).not.toMatch(/\d/);
    expect(card.body).toMatch(/to confirm/);
  });
});

describe("the workspace pipeline", () => {
  it("adds a plan's drafts once, moves them through the stages, and logs exactly what was marked sent", async () => {
    const { repo, user } = await person("ana@pipe.test");
    const planId = await planIn(repo);
    queries.length = 0;
    expect(await repo.pipeline.addFromPlan(planId)).toBe(2);
    expect(await repo.pipeline.addFromPlan(planId)).toBe(0);
    let cards = await repo.pipeline.list();
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.stage === "drafted" && c.ownerId === user.id)).toBe(true);
    const partner = cards.find((c) => c.kind === "partner")!;

    // The user edits the draft, then marks the version they saw as sent.
    await repo.pipeline.edit(partner.id, { recipient: partner.recipient, recipientEmail: "events@partner.test", subject: "Hello", body: "A short note." });
    await expect(repo.pipeline.move(partner.id, "sent", partner.hash)).rejects.toBeInstanceOf(InputError);
    const seen = (await repo.pipeline.get(partner.id))!.card.hash;
    expect(seen).toBe(contentHash({ recipient: partner.recipient, recipientEmail: "events@partner.test", subject: "Hello", body: "A short note." }));
    await repo.pipeline.move(partner.id, "sent", seen);
    await repo.pipeline.move(partner.id, "replied");
    await repo.pipeline.move(partner.id, "booked");

    const { card, events } = (await repo.pipeline.get(partner.id))!;
    expect(card).toMatchObject({ stage: "booked", sentBy: user.id, contentHash: seen });
    expect(events.map((e) => e.toStage)).toEqual(["drafted", "sent", "replied", "booked"]);
    expect(events[1].sent).toEqual({ recipient: partner.recipient, recipientEmail: "events@partner.test", subject: "Hello", body: "A short note.", contentHash: seen });
    expect(events.filter((e) => e.sent)).toHaveLength(1);
    await expect(repo.pipeline.edit(partner.id, { recipient: "x", recipientEmail: null, subject: "x", body: "x" })).rejects.toThrow(/Only drafts/);

    cards = await repo.pipeline.list();
    expect(cards[0].id).toBe(partner.id);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("adds a shortlisted sponsor match, and finds cards by recipient", async () => {
    const { repo } = await person("bo@pipe.test");
    const matchId = await repo.sponsorship.save({ view: "rights", holderKey: "act-1", brandId: "brand-1", pitch: pitch("Fred again..", "Liquid Death") });
    expect(await repo.pipeline.addFromMatch(matchId)).toBe(1);
    expect(await repo.pipeline.addFromMatch(matchId)).toBe(0);
    const [card] = await repo.pipeline.list();
    expect(card).toMatchObject({ kind: "sponsor", context: "Fred again.. × Liquid Death", sponsorMatchId: matchId });
    expect((await repo.search("Liquid")).some((r) => r.kind === "Outreach" && r.href.includes(card.id))).toBe(true);
  });

  it("keeps every card inside its workspace", async () => {
    const a = await person("cy@pipe.test");
    const b = await person("di@pipe.test");
    const planId = await planIn(a.repo);
    await a.repo.pipeline.addFromPlan(planId);
    const [card] = await a.repo.pipeline.list();
    queries.length = 0;
    expect(await b.repo.pipeline.list()).toEqual([]);
    expect(await b.repo.pipeline.get(card.id)).toBeNull();
    await expect(b.repo.pipeline.addFromPlan(planId)).rejects.toBeInstanceOf(InputError);
    await expect(b.repo.pipeline.move(card.id, "lost")).rejects.toBeInstanceOf(InputError);
    await b.repo.pipeline.remove(card.id);
    expect(await a.repo.pipeline.get(card.id)).not.toBeNull();
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("lets viewers read the board but not change it", async () => {
    const owner = await person("ed@pipe.test");
    const viewer = await addUser(db, "fi@pipe.test");
    const { token } = await owner.repo.invitations.create(viewer.email, "viewer");
    await unscopedAcceptInvitation(db, token, viewer);
    const repo = forWorkspace(db, { userId: viewer.id, workspaceId: owner.workspaceId, role: "viewer" });
    const planId = await planIn(owner.repo);
    await owner.repo.pipeline.addFromPlan(planId);
    const [card] = await repo.pipeline.list();
    await expect(repo.pipeline.move(card.id, "sent", card.hash)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(repo.pipeline.addFromPlan(planId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("nothing in the pipeline sends email (rule 5)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });

  it("no pipeline module, route or screen imports an email sender", () => {
    const sources = [...files("lib/pipeline"), ...files("app/api/workspace/pipeline"), ...files("app/workspace/pipeline"), "components/workspace/pipeline.tsx"];
    for (const f of sources) expect(readFileSync(f, "utf8"), f).not.toMatch(/@\/lib\/email|from "resend"/);
  });

  it("the agent has no tool that touches the pipeline", () => {
    for (const f of [...files("lib/agent"), ...files("lib/tools")]) expect(readFileSync(f, "utf8"), f).not.toMatch(/pipeline/i);
  });
});
