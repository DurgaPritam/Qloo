import type { Metadata } from "next";
import { Suspense } from "react";

import { VenueBooker } from "@/components/tools/venue-booker";
import { AppHeader, Page } from "@/components/ui";

export const metadata: Metadata = { title: "Venue booker · Takeover" };

export default function VenuePage() {
  return (
    <Page max="max-w-[1180px]">
      <AppHeader />
      <Suspense>
        <VenueBooker />
      </Suspense>
    </Page>
  );
}
