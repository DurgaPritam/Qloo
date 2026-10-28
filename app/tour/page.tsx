import type { Metadata } from "next";
import { Suspense } from "react";

import { TourPlanner } from "@/components/tools/tour-planner";
import { AppHeader, Page } from "@/components/ui";

export const metadata: Metadata = { title: "Tour optimizer · Takeover" };

export default function PageTourPlanner() {
  return (
    <Page max="max-w-[1180px]">
      <AppHeader />
      <Suspense>
        <TourPlanner />
      </Suspense>
    </Page>
  );
}
