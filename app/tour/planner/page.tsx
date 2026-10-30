import type { Metadata } from "next";
import { Suspense } from "react";

import { ItineraryPlanner } from "@/components/tools/itinerary-planner";
import { AppHeader, Page } from "@/components/ui";
import { itineraryFromTour } from "@/lib/itinerary/from-tour";
import { parseItinerary } from "@/lib/itinerary/types";
import { metroPool } from "@/lib/tools/shared";
import { tourDraft } from "@/lib/tools/tour";
import { featureAccess } from "@/lib/workspace/gate";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Tour planner · Takeover" };

const UUID = /^[0-9a-f-]{36}$/;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/**
 * ?draft=<id> opens a finished Tour optimizer route (its server-side draft) as a new itinerary;
 * ?id=<id> opens one saved in the workspace; ?local=<key> one kept in this browser (read client side).
 */
async function Planner({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, found] = await Promise.all([searchParams, currentWorkspace()]);
  const draftId = one(params.draft);
  const route = UUID.test(draftId) ? await tourDraft(draftId) : null;
  const draft = route && !route.route.infeasible ? itineraryFromTour(route, { startDate: one(params.start), admin1: (id) => metroPool().find((c) => c.id === id)?.admin1 ?? "" }) : undefined;
  // A new address (another saved tour, another route) starts a fresh editor.
  const key = `${one(params.id)}|${draftId}`;
  if (!found) return <ItineraryPlanner key={key} workspace={null} draft={draft} draftExpired={Boolean(draftId && !draft)} />;
  const name = found.memberships.find((m) => m.workspaceId === found.ctx.workspaceId)?.name ?? "your workspace";
  const id = one(params.id);
  const [list, row, access] = await Promise.all([found.repo.itineraries.list(), UUID.test(id) ? found.repo.itineraries.get(id) : null, featureAccess(found.repo, "optimizers")]);
  const opened = row ? parseItinerary(row.data) : null;
  return (
    <ItineraryPlanner
      key={key}
      workspace={{ name, canSave: access.allowed, upgradeLabel: access.upgrade?.label ?? null, saved: list.map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt.toISOString() })) }}
      opened={row && opened ? { id: row.id, itinerary: opened, updatedAt: row.updatedAt.toISOString() } : undefined}
      openedMissing={Boolean(id && !row)}
      draft={draft}
      draftExpired={Boolean(draftId && !draft)}
    />
  );
}

export default function PageItineraryPlanner({ searchParams }: PageProps<"/tour/planner">) {
  return (
    <Page max="max-w-[1180px]">
      <AppHeader />
      <Suspense>
        <Planner searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
