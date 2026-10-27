import type { Metadata } from "next";
import { Suspense } from "react";

import { FanOverlap } from "@/components/tools/fan-overlap";
import { AppHeader, Page } from "@/components/ui";

export const metadata: Metadata = { title: "Fan overlap · Takeover" };

export default function PageFanOverlap() {
  return (
    <Page max="max-w-[1180px]">
      <AppHeader />
      <Suspense>
        <FanOverlap />
      </Suspense>
    </Page>
  );
}
