import type { Metadata } from "next";
import { Suspense } from "react";

import { CityExplorer } from "@/components/tools/city-explorer";
import { AppHeader, Page } from "@/components/ui";

export const metadata: Metadata = { title: "City explorer · Takeover" };

export default function PageCityExplorer() {
  return (
    <Page max="max-w-[1180px]">
      <AppHeader />
      <Suspense>
        <CityExplorer />
      </Suspense>
    </Page>
  );
}
