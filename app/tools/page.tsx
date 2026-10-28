import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader, MonoLabel, Page } from "@/components/ui";
import { TOOLS } from "@/lib/site";

export const metadata: Metadata = {
  title: "Tools · Takeover",
  description: "Fan overlap, Meet the fan, Lineup builder, Brand match, Venue booker, City explorer, Tour optimizer and city pages, all on Qloo taste data.",
};

export default function ToolsPage() {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Tools</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">Every way in</h1>
        <p className="m-0 max-w-[62ch] text-body text-mute [text-wrap:pretty]">
          Start from two fans, a headliner, a brand, a city or a map. Every answer is Qloo taste data, and every result links to a
          full takeover plan.
        </p>
      </section>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))]">
        {TOOLS.map((t) => (
          <div key={t.href} className="flex flex-col gap-1.5 rounded-md bg-surf p-panel border-card border-ink shadow-card">
            <div className="font-mono text-label uppercase tracking-[0.08em] text-acc-text">{t.who}</div>
            <Link href={t.href} className="t-display text-[24px] leading-[1.05] text-ink no-underline hover:underline">
              {t.label}
            </Link>
            <div className="text-chip text-mute [text-wrap:pretty]">{t.body}</div>
            <div className="mt-auto flex flex-wrap gap-3 pt-1 text-chip">
              <Link href={t.href}>Open</Link>
              <Link href={t.example}>See an example →</Link>
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
