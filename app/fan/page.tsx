import type { Metadata } from "next";

import { FanSearch } from "@/components/fan-search";
import { AppHeader, MonoLabel, Page } from "@/components/ui";

export const metadata: Metadata = {
  title: "Meet the fan · Takeover",
  description: "Type any fanbase and meet its typical fan: who they are and what else they love, from Qloo taste data.",
};

export default function FanIndex() {
  return (
    <Page>
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Meet the fan</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">Who are the fans, really?</h1>
        <p className="m-0 max-w-[62ch] text-body text-mute [text-wrap:pretty]">
          Type any artist, show, team or brand. See who its fans are and the music, shows, films, podcasts, brands and books they
          over-index on. Every fact is Qloo taste data; share the card.
        </p>
      </section>
      <FanSearch />
    </Page>
  );
}
