import type { Metadata } from "next";
import { Suspense } from "react";

import { LineupBuilder } from "@/components/tools/lineup-builder";
import { AppHeader, Page } from "@/components/ui";

export const metadata: Metadata = {
  title: "Lineup optimizer · Takeover",
  description: "Pick a headliner; Qloo suggests the support acts, host, city and venue. Get a poster with the lineup's crowd fit.",
};

export default function LineupPage() {
  return (
    <Page max="max-w-[1180px]">
      <AppHeader />
      <Suspense>
        <LineupBuilder />
      </Suspense>
    </Page>
  );
}
