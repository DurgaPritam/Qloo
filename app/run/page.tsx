import type { Metadata } from "next";
import { Suspense } from "react";

import { RunScreen } from "@/components/run/run-screen";
import { Page, Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Run · Takeover" };

export default function RunPage() {
  return (
    <Suspense
      fallback={
        <Page max="max-w-[1280px]">
          <Skeleton className="h-[26px] w-[45%] rounded-btn" />
          <Skeleton className="aspect-video w-full rounded-md" />
        </Page>
      }
    >
      <RunScreen />
    </Suspense>
  );
}
