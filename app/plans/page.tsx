import type { Metadata } from "next";

import { SavedPlans } from "@/components/saved-plans";
import { AppHeader, MonoLabel, Page } from "@/components/ui";

export const metadata: Metadata = { title: "My plans · Takeover" };

export default function PlansPage() {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>My plans</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">Your takeovers</h1>
        <p className="m-0 max-w-[62ch] text-body text-mute [text-wrap:pretty]">
          Every plan you finish is kept here, in this browser only: no account, nothing stored about you. Rename them, compare
          two side by side, or share the link.
        </p>
      </section>
      <SavedPlans />
    </Page>
  );
}
