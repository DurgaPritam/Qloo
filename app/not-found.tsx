import Link from "next/link";

import { AppHeader, Page } from "@/components/ui";

export default function NotFound() {
  return (
    <Page>
      <AppHeader />
      <section className="flex flex-col gap-3 pt-[min(14vh,112px)]">
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">We couldn&apos;t find that page</h1>
        <p className="m-0 text-body text-mute">
          Shared plans are kept for 30 days. <Link href="/">Plan a new takeover</Link>.
        </p>
      </section>
    </Page>
  );
}
