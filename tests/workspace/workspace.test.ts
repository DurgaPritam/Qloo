import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Plan } from "@/lib/agent/types";
import type { DB } from "@/lib/db";
import { forWorkspace, InputError, type WorkspaceRepo } from "@/lib/db/scoped";
import { invitations, TENANT_TABLES, type Role } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace, unscopedInvitationByToken } from "@/lib/db/unscoped";
import { MockQlooSource } from "@/lib/qloo/mock";
import { contextFor, importBrowserPlans, planForViewer } from "@/lib/workspace/context";
import { ForbiddenError } from "@/lib/workspace/permissions";
import { planTargets } from "@/lib/workspace/targets";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

let db: DB;
let queries: LoggedQuery[];
let template: Plan;

const plan = (id = crypto.randomUUID()): Plan => ({ ...template, runId: id });
const noAnonymous = async () => null;

/** A user with a personal workspace, plus a repo acting as them there. */
async function person(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  const repo = forWorkspace(db, { userId: user.id, workspaceId, role: "owner" });
  return { user, workspaceId, repo };
}

/** Invites `email` to the owner's workspace with `role`, accepts it, and returns the member's repo. */
async function join(owner: WorkspaceRepo, member: { id: string; email: string }, role: Exclude<Role, "owner">) {
  const { token } = await owner.invitations.create(member.email, role);
  const accepted = await unscopedAcceptInvitation(db, token, member);
  expect(accepted.ok).toBe(true);
  return forWorkspace(db, { userId: member.id, workspaceId: owner.context.workspaceId, role });
}

beforeAll(async () => {
  ({ db, queries } = await testDb());
  template = await runAgent(
    { query: "Phoebe Bridgers" },
    { runId: "template", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} },
  );
  expect(template.status).toBe("complete");
});

beforeEach(() => {
  queries.length = 0;
});

describe("workspace scoping", () => {
  it("a member of A can never read B's plans or comments", async () => {
    const a = await person("alex@a.test");
    const b = await person("bo@b.test");
    const planB = plan();
    await b.repo.plans.create({ id: planB.runId, query: "Phoebe Bridgers", result: planB });
    const { id: commentB } = await b.repo.comments.add({ planId: planB.runId, targetType: "plan", targetId: planB.runId, body: "B only" });

    queries.length = 0;
    expect(await a.repo.plans.get(planB.runId)).toBeNull();
    expect(await a.repo.plans.list()).toEqual([]);
    expect(await a.repo.comments.list(planB.runId)).toEqual([]);
    await expect(a.repo.comments.add({ planId: planB.runId, targetType: "plan", targetId: planB.runId, body: "hi" })).rejects.toThrow(InputError);
    await expect(a.repo.comments.resolve(commentB, true)).rejects.toThrow(InputError);
    await expect(a.repo.plans.setVisibility(planB.runId, "public")).rejects.toThrow(InputError);
    expect(await a.repo.activity.list()).not.toContainEqual(expect.objectContaining({ targetId: commentB }));
    // Every query those calls made was scoped to A.
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("the request context only ever picks a workspace the user belongs to", async () => {
    const a = await person("ari@a.test");
    const b = await person("bea@b.test");
    const chosen = await contextFor(db, a.user.id, b.workspaceId);
    expect(chosen?.ctx.workspaceId).toBe(a.workspaceId);
    expect(chosen?.memberships.map((m) => m.workspaceId)).toEqual([a.workspaceId]);
  });

  it("every repository call is scoped (checked across a full workflow)", async () => {
    const owner = await person("olu@scope.test");
    const member = await join(owner.repo, await addUser(db, "mae@scope.test", "Mae"), "member");
    const p = plan();
    await owner.repo.plans.create({ id: p.runId, query: "x", result: p });
    const { id } = await member.comments.add({ planId: p.runId, targetType: "plan", targetId: p.runId, body: "@olu look" });
    await owner.repo.comments.add({ planId: p.runId, targetType: "plan", targetId: p.runId, parentId: id, body: "on it" });
    await member.comments.resolve(id, true);
    await owner.repo.notifications.list();
    await owner.repo.notifications.unread();
    await owner.repo.notifications.markAllRead();
    await owner.repo.members.list();
    await owner.repo.invitations.listPending();
    await owner.repo.plans.setVisibility(p.runId, "public");
    await owner.repo.plans.importFromBrowser([plan()]);
    await owner.repo.activity.list();
    expectAllScoped(queries.filter((q) => !/"invitations"\."token_hash" =|"memberships"\."user_id" = \$\d+ order/.test(q.sql)), TENANT_TABLES);
  });
});

describe("role permissions", () => {
  it("viewers read but cannot plan, comment or resolve", async () => {
    const owner = await person("owen@roles.test");
    const p = plan();
    await owner.repo.plans.create({ id: p.runId, query: "x", result: p });
    const viewer = await join(owner.repo, await addUser(db, "vi@roles.test"), "viewer");
    expect(await viewer.plans.get(p.runId)).not.toBeNull();
    await expect(viewer.plans.create({ id: crypto.randomUUID(), query: "y", result: plan() })).rejects.toThrow(ForbiddenError);
    await expect(viewer.comments.add({ planId: p.runId, targetType: "plan", targetId: p.runId, body: "hi" })).rejects.toThrow(ForbiddenError);
    await expect(viewer.invitations.create("x@roles.test", "member")).rejects.toThrow(ForbiddenError);
  });

  it("members share only their own plans and cannot invite; admins can", async () => {
    const owner = await person("oona@roles.test");
    const ownersPlan = plan();
    await owner.repo.plans.create({ id: ownersPlan.runId, query: "x", result: ownersPlan });
    const member = await join(owner.repo, await addUser(db, "mo@roles.test"), "member");
    const mine = plan();
    await member.plans.create({ id: mine.runId, query: "y", result: mine });
    await member.plans.setVisibility(mine.runId, "public");
    await expect(member.plans.setVisibility(ownersPlan.runId, "public")).rejects.toThrow(ForbiddenError);
    await expect(member.invitations.create("z@roles.test", "viewer")).rejects.toThrow(ForbiddenError);

    const admin = await join(owner.repo, await addUser(db, "ada@roles.test"), "admin");
    await admin.plans.setVisibility(ownersPlan.runId, "public");
    await admin.invitations.create("new@roles.test", "member");
  });

  it("admins cannot touch owners or hand out ownership; the last owner cannot leave", async () => {
    const owner = await person("orla@roles.test");
    const admin = await join(owner.repo, await addUser(db, "abe@roles.test"), "admin");
    const memberUser = await addUser(db, "max@roles.test");
    await join(owner.repo, memberUser, "member");
    await expect(admin.members.changeRole(owner.user.id, "member")).rejects.toThrow(ForbiddenError);
    await expect(admin.members.remove(owner.user.id)).rejects.toThrow(ForbiddenError);
    await expect(admin.members.changeRole(memberUser.id, "owner")).rejects.toThrow(ForbiddenError);
    await admin.members.changeRole(memberUser.id, "viewer");
    await expect(owner.repo.members.remove(owner.user.id)).rejects.toThrow(/at least one owner/);
    await expect(owner.repo.members.changeRole(owner.user.id, "admin")).rejects.toThrow(/at least one owner/);
    await owner.repo.members.remove(memberUser.id);
    expect((await owner.repo.members.list()).map((m) => m.userId)).not.toContain(memberUser.id);
  });

  it("only owners rename the workspace", async () => {
    const owner = await person("ozzy@roles.test");
    const admin = await join(owner.repo, await addUser(db, "al@roles.test"), "admin");
    await expect(admin.workspace.rename("Mine now")).rejects.toThrow(ForbiddenError);
    await owner.repo.workspace.rename("Tour team");
    expect((await owner.repo.workspace.get())?.name).toBe("Tour team");
  });
});

describe("invitations", () => {
  it("accepts with the invited email only, once, with the invited role", async () => {
    const owner = await person("iris@inv.test");
    const { token } = await owner.repo.invitations.create("  Guest@Inv.Test ", "admin");
    const stranger = await addUser(db, "other@inv.test");
    expect(await unscopedAcceptInvitation(db, token, stranger)).toEqual({ ok: false, reason: "wrong-email" });

    const guest = await addUser(db, "guest@inv.test");
    expect(await unscopedAcceptInvitation(db, token, guest)).toEqual({ ok: true, workspaceId: owner.workspaceId });
    expect(await unscopedAcceptInvitation(db, token, guest)).toEqual({ ok: true, workspaceId: owner.workspaceId });
    expect((await owner.repo.members.list()).find((m) => m.userId === guest.id)?.role).toBe("admin");
    expect((await unscopedInvitationByToken(db, token))?.state).toBe("accepted");
    expect(await owner.repo.invitations.listPending()).toEqual([]);
  });

  it("refuses unknown, revoked, replaced and expired links", async () => {
    const owner = await person("ines@inv.test");
    const invitee = await addUser(db, "late@inv.test");
    expect(await unscopedAcceptInvitation(db, "nope", invitee)).toEqual({ ok: false, reason: "not-found" });

    const first = await owner.repo.invitations.create(invitee.email, "member");
    const second = await owner.repo.invitations.create(invitee.email, "viewer");
    expect(await unscopedAcceptInvitation(db, first.token, invitee)).toEqual({ ok: false, reason: "revoked" });

    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, second.id));
    expect(await unscopedAcceptInvitation(db, second.token, invitee)).toEqual({ ok: false, reason: "expired" });

    const third = await owner.repo.invitations.create(invitee.email, "member");
    await owner.repo.invitations.revoke(third.id);
    expect(await unscopedAcceptInvitation(db, third.token, invitee)).toEqual({ ok: false, reason: "revoked" });
  });

  it("never stores the token, and refuses inviting an existing member", async () => {
    const owner = await person("ivo@inv.test");
    const { token, id } = await owner.repo.invitations.create("new@inv.test", "member");
    const [row] = await db.select().from(invitations).where(eq(invitations.id, id));
    expect(JSON.stringify(row)).not.toContain(token);
    await expect(owner.repo.invitations.create("ivo@inv.test", "member")).rejects.toThrow(/already/);
  });

  it("creates one personal workspace on first sign-in, however often it runs", async () => {
    const user = await addUser(db, "solo@inv.test", "Solo");
    const first = await unscopedEnsurePersonalWorkspace(db, user);
    expect(await unscopedEnsurePersonalWorkspace(db, user)).toBe(first);
    const ctx = await contextFor(db, user.id);
    expect(ctx?.ctx).toMatchObject({ workspaceId: first, role: "owner" });
    expect((await ctx!.repo.workspace.get())?.name).toBe("Solo's workspace");
  });
});

describe("browser-plan import", () => {
  it("copies stored plans under new ids, counts missing ones, and is idempotent", async () => {
    const owner = await person("imo@imp.test");
    const stored = [plan(), plan()];
    const load = async (id: string) => stored.find((p) => p.runId === id) ?? null;
    const ids = [...stored.map((p) => p.runId), crypto.randomUUID()];

    expect(await importBrowserPlans(owner.repo, ids, load)).toEqual({ imported: 2, already: 0, missing: 1 });
    expect(await importBrowserPlans(owner.repo, ids, load)).toEqual({ imported: 0, already: 2, missing: 1 });

    const rows = await owner.repo.plans.list();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(stored.map((p) => p.runId)).not.toContain(r.id);
      expect(r.result.runId).toBe(r.id);
      expect(r.visibility).toBe("workspace");
    }
  });

  it("viewers cannot import", async () => {
    const owner = await person("ivy@imp.test");
    const viewer = await join(owner.repo, await addUser(db, "vee@imp.test"), "viewer");
    await expect(importBrowserPlans(viewer, [template.runId], async () => template)).rejects.toThrow(ForbiddenError);
  });
});

describe("share links", () => {
  it("workspace plans are private until made public; signed-out plans stay public", async () => {
    const owner = await person("sam@share.test");
    const outsider = await person("out@share.test");
    const p = plan();
    await owner.repo.plans.create({ id: p.runId, query: "x", result: p });

    expect(await planForViewer(db, p.runId, null, noAnonymous)).toBeNull();
    expect(await planForViewer(db, p.runId, outsider.user.id, noAnonymous)).toBeNull();
    expect(await planForViewer(db, p.runId, owner.user.id, noAnonymous)).toMatchObject({ kind: "member", visibility: "workspace" });

    await owner.repo.plans.setVisibility(p.runId, "public");
    expect(await planForViewer(db, p.runId, null, noAnonymous)).toMatchObject({ kind: "public" });
    expect(await planForViewer(db, p.runId, outsider.user.id, noAnonymous)).toMatchObject({ kind: "public" });

    await owner.repo.plans.setVisibility(p.runId, "workspace");
    expect(await planForViewer(db, p.runId, null, noAnonymous)).toBeNull();

    const anon = plan();
    expect(await planForViewer(db, anon.runId, null, async (id) => (id === anon.runId ? anon : null))).toMatchObject({ kind: "anonymous" });
    expect(await planForViewer(db, crypto.randomUUID(), null, noAnonymous)).toBeNull();
  });
});

describe("comments", () => {
  it("threads replies, resolves the thread, and notifies @mentioned members only", async () => {
    const owner = await person("cara@c.test");
    const memberUser = await addUser(db, "dev@c.test", "Dev");
    const member = await join(owner.repo, memberUser, "member");
    const outsider = await person("dev@elsewhere.test");
    const p = plan();
    await owner.repo.plans.create({ id: p.runId, query: "x", result: p });
    const city = planTargets(p).find((t) => t.type === "city")!;

    const root = await owner.repo.comments.add({ planId: p.runId, targetType: "city", targetId: city.id, body: "@dev is this the right city? cc @nobody" });
    expect(root.mentioned).toEqual([memberUser.id]);
    const reply = await member.comments.add({ planId: p.runId, targetType: "city", targetId: city.id, parentId: root.id, body: "Yes." });
    // A reply to a reply joins the same thread.
    await owner.repo.comments.add({ planId: p.runId, targetType: "city", targetId: city.id, parentId: reply.id, body: "Thanks" });
    const list = await owner.repo.comments.list(p.runId);
    expect(list.filter((c) => c.parentId === root.id)).toHaveLength(2);

    await expect(member.comments.resolve(reply.id, true)).rejects.toThrow(/first comment/);
    await member.comments.resolve(root.id, true);
    expect((await owner.repo.comments.list(p.runId)).find((c) => c.id === root.id)?.resolvedAt).toBeInstanceOf(Date);

    expect(await member.notifications.unread()).toBe(1);
    expect(await outsider.repo.notifications.unread()).toBe(0);
    await member.notifications.markAllRead();
    expect(await member.notifications.unread()).toBe(0);

    await expect(owner.repo.comments.add({ planId: p.runId, targetType: "venue", targetId: "not-in-plan", body: "x" })).rejects.toThrow(/decisions/);
  });
});
