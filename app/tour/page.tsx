import type { Metadata } from "next";
import { Suspense } from "react";

import { TourPlanner } from "@/components/tools/tour-planner";
import { AppHeader, Page } from "@/components/ui";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Tour optimizer · Takeover" };

/** Signed in: the workspace to save to, its saved tours, and the one opened by ?saved=<id>. */
async function Planner({ searchParams }: { searchParams: Promise<{ saved?: string | string[] }> }) {
  const [{ saved }, found] = await Promise.all([searchParams, currentWorkspace()]);
  if (!found) return <TourPlanner workspace={null} />;
  const name = found.memberships.find((m) => m.workspaceId === found.ctx.workspaceId)?.name ?? "your workspace";
  const [list, open] = await Promise.all([found.repo.tours.list(), typeof saved === "string" && /^[0-9a-f-]{36}$/.test(saved) ? found.repo.tours.get(saved) : null]);
  return (
    <TourPlanner
      workspace={{ name, tours: list.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt.toISOString() })) }}
      saved={open ? { id: open.id, name: open.name, result: open.result, userData: open.userData, createdAt: open.createdAt.toISOString() } : undefined}
    />
  );
}

export default function PageTourPlanner({ searchParams }: PageProps<"/tour">) {
  return (
    <Page max="max-w-[1180px]">
      <AppHeader />
      <Suspense>
        <Planner searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
