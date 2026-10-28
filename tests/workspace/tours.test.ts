import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { TENANT_TABLES } from "@/lib/db/schema";
import { unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { MockQlooSource } from "@/lib/qloo/mock";
import { optimizeFanTour, saveTourDraft, tourDraft, type SavedTourResult } from "@/lib/tools/tour";
import { ForbiddenError } from "@/lib/workspace/permissions";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

let db: DB;
let queries: LoggedQuery[];
let tour: SavedTourResult;

async function person(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  return { user, workspaceId, repo: forWorkspace(db, { userId: user.id, workspaceId, role: "owner" }) };
}

beforeAll(async () => {
  ({ db, queries } = await testDb());
  const r = await optimizeFanTour("John Mulaney", undefined, { region: "US", stops: 4, maxLegKm: null }, new MockQlooSource(), { runId: "tour-test" });
  if (r.status !== "done") throw new Error("the mock should route John Mulaney");
  tour = r;
});
beforeEach(() => {
  queries.length = 0;
});

describe("saved tours", () => {
  it("keep the engine's result from the server-side draft, beside the user's own dates", async () => {
    const id = await saveTourDraft(tour);
    expect(await tourDraft(id)).toEqual(tour);
    expect(await tourDraft("not-a-draft")).toBeNull();
    const { repo } = await person("tia@tour.test");
    const first = tour.route.stops[0].city.id;
    queries.length = 0;
    const saved = await repo.tours.save("John Mulaney · 4 stops · United States", (await tourDraft(id))!, { window: { from: "2027-03-01", to: "2027-03-20" }, stops: { [first]: { band: "Theater · 500–3k", date: "2027-03-02" } } });
    const row = (await repo.tours.get(saved))!;
    expect(row.result.route).toEqual(tour.route);
    expect(row.userData.stops[first]).toEqual({ band: "Theater · 500–3k", date: "2027-03-02" });
    expect((await repo.tours.list()).map((t) => t.id)).toEqual([saved]);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("stay inside their workspace, and viewers cannot save", async () => {
    const a = await person("uma@tour.test");
    const b = await person("vic@tour.test");
    const id = await a.repo.tours.save("A tour", tour, { window: { from: "", to: "" }, stops: {} });
    queries.length = 0;
    expect(await b.repo.tours.get(id)).toBeNull();
    expect(await b.repo.tours.list()).toEqual([]);
    await b.repo.tours.remove(id);
    expect(await a.repo.tours.get(id)).not.toBeNull();
    expectAllScoped(queries, TENANT_TABLES);
    const viewer = forWorkspace(db, { userId: b.user.id, workspaceId: a.workspaceId, role: "viewer" });
    await expect(viewer.tours.save("x", tour, { window: { from: "", to: "" }, stops: {} })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
