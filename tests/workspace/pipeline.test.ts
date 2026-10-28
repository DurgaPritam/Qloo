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
import { readOutbox } from "@/lib/email/mailer";
import { cardFromMatch, cardsFromPlan, contentHash } from "@/lib/pipeline/drafts";
import { localDate, sendReminders } from "@/lib/pipeline/reminders";
import { readUnsubscribeToken } from "@/lib/watch/token";
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

  it("no pipeline module, route or screen imports an email sender, except overdue reminders to the owner", () => {
    const sources = [...files("lib/pipeline"), ...files("app/api/workspace/pipeline"), ...files("app/workspace/pipeline"), "components/workspace/pipeline.tsx"];
    for (const f of sources.filter((x) => !x.endsWith("lib/pipeline/reminders.ts"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/@\/lib\/email|from "resend"/);
    // The one that may send writes only to owners' own addresses (tested below), never to a contact.
    expect(readFileSync("lib/pipeline/reminders.ts", "utf8")).not.toMatch(/recipientEmail/);
  });

  it("the agent has no tool that touches the pipeline", () => {
    for (const f of [...files("lib/agent"), ...files("lib/tools")]) expect(readFileSync(f, "utf8"), f).not.toMatch(/pipeline/i);
  });
});

describe("owners, tracking, comments and reminders", () => {
  it("reassigns only to members, keeps tracking fields at any stage, and threads comments with mentions", async () => {
    const owner = await person("own@pipe.test");
    const mate = await addUser(db, "mate@pipe.test", "Mate");
    const { token } = await owner.repo.invitations.create(mate.email, "member");
    await unscopedAcceptInvitation(db, token, mate);
    const outsider = await person("out@pipe.test");
    await owner.repo.pipeline.addFromPlan(await planIn(owner.repo));
    const [card] = await owner.repo.pipeline.list();
    expect(card.ownerId).toBe(owner.user.id);
    queries.length = 0;
    await expect(owner.repo.pipeline.assign(card.id, outsider.user.id)).rejects.toThrow(/someone in this workspace/);
    await owner.repo.pipeline.assign(card.id, mate.id);
    await owner.repo.pipeline.move(card.id, "sent", card.hash);
    await owner.repo.pipeline.track(card.id, { contactName: "Dana at the venue", dueDate: "2026-11-05", notes: "Prefers phone" });
    const after = (await owner.repo.pipeline.get(card.id))!.card;
    expect(after).toMatchObject({ ownerId: mate.id, contactName: "Dana at the venue", dueDate: "2026-11-05", notes: "Prefers phone", stage: "sent" });

    const { id: root, mentioned } = await owner.repo.pipeline.comment(card.id, { body: "@mate can you chase this?" });
    expect(mentioned).toEqual([mate.id]);
    await owner.repo.pipeline.comment(card.id, { body: "On it", parentId: root });
    const thread = await owner.repo.pipeline.comments(card.id);
    expect(thread.map((c) => [c.body, c.parentId])).toEqual([["@mate can you chase this?", null], ["On it", root]]);
    // Card comments never appear among a plan's threads.
    expect((await owner.repo.comments.list(card.planId!)).length).toBe(0);
    const mateRepo = forWorkspace(db, { userId: mate.id, workspaceId: owner.workspaceId, role: "member" });
    expect((await mateRepo.notifications.list()).find((n) => n.outreachId === card.id)).toMatchObject({ kind: "mention", cardRecipient: card.recipient });
    expectAllScoped(queries, TENANT_TABLES);

    await expect(outsider.repo.pipeline.comment(card.id, { body: "hi" })).rejects.toBeInstanceOf(InputError);
    await expect(outsider.repo.pipeline.track(card.id, { contactName: null, dueDate: null, notes: null })).rejects.toBeInstanceOf(InputError);
  });

  it("reminds each owner once per due date, never for booked or lost cards, and emails only owners who opted in", async () => {
    const a = await person("rem@pipe.test");
    await a.repo.pipeline.addFromPlan(await planIn(a.repo));
    const [one, two] = await a.repo.pipeline.list();
    await a.repo.pipeline.track(one.id, { contactName: null, dueDate: "2026-10-20", notes: null });
    await a.repo.pipeline.track(two.id, { contactName: null, dueDate: "2026-10-20", notes: null });
    await a.repo.pipeline.move(two.id, "lost");
    queries.length = 0;

    const first = await sendReminders(a.repo, { now: new Date("2026-10-28T12:00:00Z"), appUrl: "https://takeover.test" });
    expect(first).toEqual({ reminded: 1, emailed: [] }); // in-app only: emails are opt-in
    expect(await sendReminders(a.repo, { now: new Date("2026-10-29T12:00:00Z"), appUrl: "https://takeover.test" })).toEqual({ reminded: 0, emailed: [] });
    expect((await a.repo.notifications.list()).filter((n) => n.kind === "overdue").map((n) => n.outreachId)).toEqual([one.id]);
    expectAllScoped(queries, TENANT_TABLES);

    // A new due date reminds again; with emails on, the owner gets one, with a reminders-only unsubscribe link.
    await a.repo.digest.setReminders(true);
    await a.repo.pipeline.track(one.id, { contactName: null, dueDate: "2026-10-27", notes: null });
    const r = await sendReminders(a.repo, { now: new Date("2026-10-28T12:00:00Z"), appUrl: "https://takeover.test" });
    expect(r).toEqual({ reminded: 1, emailed: [a.user.id] });
    const [mail] = readOutbox("rem@pipe.test");
    expect(mail.subject).toMatch(/1 pipeline follow-up overdue/);
    const link = new URL(mail.text.match(/https:\/\/takeover\.test\/unsubscribe\/reminders\?token=\S+/)![0]);
    const t = link.searchParams.get("token")!;
    expect(readUnsubscribeToken(t, undefined, "reminders")).toEqual({ workspaceId: a.workspaceId, userId: a.user.id });
    expect(readUnsubscribeToken(t)).toBeNull(); // not a digest token
  });

  it("counts a card as due on the workspace's own date", () => {
    expect(localDate(new Date("2026-10-28T02:00:00Z"), "America/Los_Angeles")).toBe("2026-10-27");
    expect(localDate(new Date("2026-10-28T02:00:00Z"), null)).toBe("2026-10-28");
    expect(localDate(new Date("2026-10-28T02:00:00Z"), "Not/AZone")).toBe("2026-10-28");
  });
});

