import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader, MonoLabel, Page } from "@/components/ui";
import { CITIES } from "@/lib/engine/data";
import { findCity } from "@/lib/engine/local";
import { citySlug, FEATURED_CITIES } from "@/lib/site";

export const metadata: Metadata = {
  title: "City taste pages · Takeover",
  description: "What each city over-indexes on: artists, comedians, podcasts and brands, from Qloo taste data.",
};

export default function CityIndex() {
  const cities = FEATURED_CITIES.map((n) => findCity(n, CITIES)).filter((c) => c !== null);
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>City pages</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">What every city is into</h1>
        <p className="m-0 max-w-[62ch] text-body text-mute [text-wrap:pretty]">
          The artists, comedians, podcasts and brands each city over-indexes on, from Qloo. Any other city works too: try the
          Venue booker.
        </p>
      </section>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr))]">
        {cities.map((c) => (
          <Link
            key={c.id}
            href={`/city/${citySlug(c.name)}`}
            className="flex flex-col gap-0.5 rounded-md bg-surf p-[18px] text-ink no-underline border-card border-ink shadow-card hover:bg-acc-soft"
          >
            <span className="t-display text-[22px] leading-none">{c.name}</span>
            <span className="text-chip text-mute">{c.admin1 && c.admin1 !== c.name ? `${c.admin1}, ${c.country}` : c.country}</span>
          </Link>
        ))}
      </div>
    </Page>
  );
}
