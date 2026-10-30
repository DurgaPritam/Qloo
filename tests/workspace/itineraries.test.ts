import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { TENANT_TABLES } from "@/lib/db/schema";
import { unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { itineraryFromTour } from "@/lib/itinerary/from-tour";
import { parseItinerary, type Itinerary } from "@/lib/itinerary/types";
import { MockQlooSource } from "@/lib/qloo/mock";
import { optimizeFanTour } from "@/lib/tools/tour";
import { ForbiddenError } from "@/lib/workspace/permissions";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

let db: DB;
let queries: LoggedQuery[];
let itinerary: Itinerary;

async function person(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  return { user, workspaceId, repo: forWorkspace(db, { userId: user.id, workspaceId, role: "owner" }) };
}

beforeAll(async () => {
  ({ db, queries } = await testDb());
  const r = await optimizeFanTour("John Mulaney", undefined, { region: "US", stops: 4, maxLegKm: null }, new MockQlooSource(), { runId: "itinerary-test" });
  if (r.status !== "done") throw new Error("the mock should route John Mulaney");
  itinerary = itineraryFromTour(r, { startDate: "2027-03-01" });
});
beforeEach(() => {
  queries.length = 0;
});

describe("itineraries from a route", () => {
  it("keep the route's cities, order and Qloo heat, and nothing the user did not enter", () => {
    expect(itinerary.stops).toHaveLength(4);
    expect(itinerary.stops.every((s) => s.venue === null && s.support === null && s.sponsor === null && s.date === "")).toBe(true);
    expect(itinerary.stops.some((s) => s.heat && s.heat.score > 0)).toBe(true);
    expect(parseItinerary(itinerary)).toEqual(itinerary);
  });
});

describe("saved itineraries", () => {
  it("save, update, list and read back inside the workspace", async () => {
    const { repo } = await person("ida@itinerary.test");
    queries.length = 0;
    const id = await repo.itineraries.create(itinerary);
    const edited = { ...itinerary, name: "Spring run", stops: itinerary.stops.map((s, i) => (i === 0 ? { ...s, venue: { name: "The Bell House", source: "user" as const } } : s)) };
    expect(await repo.itineraries.update(id, edited)).toBe(true);
    const row = (await repo.itineraries.get(id))!;
    expect(row.name).toBe("Spring run");
    expect(row.data).toEqual(edited);
    expect((await repo.itineraries.list()).map((t) => [t.id, t.name])).toEqual([[id, "Spring run"]]);
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("stay inside their workspace, and viewers cannot write", async () => {
    const a = await person("jo@itinerary.test");
    const b = await person("kai@itinerary.test");
    const id = await a.repo.itineraries.create(itinerary);
    queries.length = 0;
    expect(await b.repo.itineraries.get(id)).toBeNull();
    expect(await b.repo.itineraries.list()).toEqual([]);
    expect(await b.repo.itineraries.update(id, { ...itinerary, name: "Hijacked" })).toBe(false);
    await b.repo.itineraries.remove(id);
    expect((await a.repo.itineraries.get(id))?.name).toBe(itinerary.name);
    expectAllScoped(queries, TENANT_TABLES);
    const viewer = forWorkspace(db, { userId: b.user.id, workspaceId: a.workspaceId, role: "viewer" });
    expect(await viewer.itineraries.get(id)).not.toBeNull();
    await expect(viewer.itineraries.create(itinerary)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(viewer.itineraries.update(id, itinerary)).rejects.toBeInstanceOf(ForbiddenError);
    await a.repo.itineraries.remove(id);
    expect(await a.repo.itineraries.get(id)).toBeNull();
  });
});
