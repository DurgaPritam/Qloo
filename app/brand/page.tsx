import type { Metadata } from "next";
import { Suspense } from "react";

import { BrandMatch } from "@/components/tools/brand-match";
import { AppHeader, Page } from "@/components/ui";

export const metadata: Metadata = { title: "Brand match · Takeover" };

export default function PageBrandMatch() {
  return (
    <Page max="max-w-[1180px]">
      <AppHeader />
      <Suspense>
        <BrandMatch />
      </Suspense>
    </Page>
  );
}
