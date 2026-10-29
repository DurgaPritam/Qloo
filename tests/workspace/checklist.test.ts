import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { TENANT_TABLES, workspaces } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { checklistView } from "@/lib/onboarding/checklist";
import { ForbiddenError } from "@/lib/workspace/permissions";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

let db: DB;
let queries: LoggedQuery[];

async function person(email: string, tier = "enterprise") {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  await db.update(workspaces).set({ tier }).where(eq(workspaces.id, workspaceId));
  return { user, workspaceId, repo: forWorkspace(db, { userId: user.id, workspaceId, role: "owner" }) };
}
const ticks = async (repo: ReturnType<typeof forWorkspace>) => Object.fromEntries((await checklistView(repo)).rows.map((r) => [r.key, r.done]));

beforeAll(async () => {
  ({ db, queries } = await testDb());
});
beforeEach(() => {
  queries.length = 0;
});

describe("the getting-started checklist", () => {
  it("ticks each step from the workspace's own data, and reads only that workspace", async () => {
    const { repo } = await person("new@check.test");
    expect(await ticks(repo)).toEqual({ run: false, roster: false, data: false, watch: false, invite: false });

    await repo.plans.create({ id: crypto.randomUUID(), query: "Phoebe Bridgers", result: { runId: "x" } as never });
    await repo.rosters.create("Fall");
    await repo.datasets.create({ name: "Sales", fileKind: "csv", fileKey: "k", fileBytes: 10, cityColumn: "city", countryColumn: null, metrics: [], rows: [] });
    await repo.watch.add({ kind: "city", targetId: "c1", name: "Austin", detail: null });
    await repo.invitations.create("mate@check.test", "member");
    expect(await ticks(repo)).toEqual({ run: true, roster: true, data: true, watch: true, invite: true });

    const other = await person("other@check.test");
    expect(Object.values(await ticks(other.repo)).some(Boolean)).toBe(false);
    queries.length = 0;
    await checklistView(repo);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("an accepted invitation counts too, and a step the plan lacks names the tier that has it", async () => {
    const owner = await person("owner@check.test", "free");
    const view = await checklistView(owner.repo);
    expect(view.rows.find((r) => r.key === "roster")?.needs).toMatchObject({ tier: "team", selfServe: true });
    expect(view.rows.find((r) => r.key === "data")?.needs).toMatchObject({ tier: "enterprise", selfServe: false });

    await db.update(workspaces).set({ tier: "team" }).where(eq(workspaces.id, owner.workspaceId));
    const mate = await addUser(db, "joined@check.test", "joined");
    const { token } = await owner.repo.invitations.create(mate.email, "member");
    await unscopedAcceptInvitation(db, token, mate);
    expect((await ticks(owner.repo)).invite).toBe(true);
  });

  it("is dismissed per workspace, by members and above", async () => {
    const a = await person("dis-a@check.test");
    const b = await person("dis-b@check.test");
    await a.repo.workspace.dismissChecklist();
    expect((await checklistView(a.repo)).dismissed).toBe(true);
    expect((await checklistView(b.repo)).dismissed).toBe(false);

    const viewer = await addUser(db, "viewer@check.test", "viewer");
    const { token } = await b.repo.invitations.create(viewer.email, "viewer");
    await unscopedAcceptInvitation(db, token, viewer);
    const asViewer = forWorkspace(db, { userId: viewer.id, workspaceId: b.workspaceId, role: "viewer" });
    expect((await checklistView(asViewer)).canDismiss).toBe(false);
    await expect(asViewer.workspace.dismissChecklist()).rejects.toBeInstanceOf(ForbiddenError);
  });
});
