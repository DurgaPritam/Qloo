"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { EXAMPLES, SHOWCASE } from "@/lib/examples";

import { AppHeader, Chip, InputBar, MonoLabel, Page, SourceBadge } from "./ui";

const STEPS = [
  { n: "01", title: "Crossover partner", body: "The artist, show, podcast or brand whose fans over-index on yours, from another category." },
  { n: "02", title: "City", body: "Where both audiences are strongest together, not just where the most people live." },
  { n: "03", title: "Room & sponsors", body: "A venue, a local opener, after-show spots and brands that already resonate with the crowd." },
  { n: "04", title: "Brief & outreach", body: "A one-page brief with every source, and two emails ready to review and send." },
];

const FAQ = [
  {
    q: "Where do the picks come from?",
    a: "From Qloo's taste data: which audiences over-index on which artists, shows, places and brands, and where. Code scores them, and every score shows the Qloo call behind it.",
  },
  {
    q: "What does the AI do?",
    a: "It writes the brief and the emails. It never picks, ranks or states a number; names and scores are filled in by code.",
  },
  {
    q: "Why does it say “to confirm with the promoter”?",
    a: "Qloo knows tastes, not venue calendars or ticket prices. Capacity, dates, prices and availability are never invented.",
  },
  {
    q: "Is it free?",
    a: "Yes. Each visitor gets five live plans and thirty lookups an hour; the example plans are always instant.",
  },
];

export function Landing({ ticker, showcase }: { ticker?: ReactNode; showcase?: ReactNode }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Busy only while the navigation is in flight. A flag set by hand would survive a Back
  // navigation (Next keeps the previous page's state) and leave the button disabled.
  const [busy, startNavigation] = useTransition();
  const plan = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    startNavigation(() => router.push(`/run?q=${encodeURIComponent(trimmed)}`));
  };

  return (
    <Page>
      <AppHeader right={<div className="font-mono text-label uppercase tracking-[0.08em] text-mute">Powered by Qloo</div>} />

      <section className="flex flex-col gap-[22px] pb-10 pt-[min(10vh,80px)]">
        <h1 className="t-display t-display-headline m-0 max-w-[16ch]">
          Pick a talent. Find the city where their audience overlaps. Get the plan.
        </h1>
        <p className="m-0 max-w-[60ch] text-body text-mute [text-wrap:pretty]">
          Any comedian, band, film, podcast or team in. A full takeover plan out in about 20 seconds, with every number from
          Qloo taste data.
        </p>
        <InputBar value={query} onChange={setQuery} onSubmit={() => plan(query)} onPick={plan} placeholder="Plan a takeover for…" busy={busy} />
        <div className="flex flex-wrap items-center gap-2">
          {EXAMPLES.map((e) => (
            <Chip
              key={e.name}
              kind={e.kind}
              label={e.name}
              onClick={() => {
                setQuery(e.name);
                plan(e.name);
              }}
            />
          ))}
          <Chip
            kind="🎲"
            label="Surprise me"
            onClick={() => {
              // A preloaded run, so it opens instantly and costs nothing.
              const pick = SHOWCASE[Math.floor(Math.random() * SHOWCASE.length)];
              setQuery(pick);
              plan(pick);
            }}
          />
        </div>
        {ticker}
      </section>

      <section className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
        <MonoLabel>What you get</MonoLabel>
        <ol className="m-0 grid list-none gap-x-[22px] gap-y-4 p-0 [grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))]">
          {STEPS.map((s) => (
            <li key={s.n} className="flex flex-col gap-1 border-l-2 border-acc-line pl-3">
              <div className="t-display text-[32px] leading-none text-acc-text">{s.n}</div>
              <div className="text-body font-medium">{s.title}</div>
              <div className="text-chip text-mute [text-wrap:pretty]">{s.body}</div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <SourceBadge />
          <p className="m-0 text-body [text-wrap:pretty]">
            Every pick is backed by Qloo taste data. Nothing Qloo doesn&apos;t know is invented.{" "}
            <Link href="/method">How the scores work</Link>
          </p>
        </div>
      </section>

      {showcase}

      <section className="flex flex-col gap-[18px] border-t border-line pb-[22px] pt-[18px]">
        <MonoLabel>Questions</MonoLabel>
        <div className="flex flex-col">
          {FAQ.map((f) => (
            <details key={f.q} className="group border-b border-line py-3">
              <summary className="cursor-pointer list-none text-body font-medium marker:hidden">
                <span className="mr-2 inline-block font-mono text-acc-text transition-transform group-open:rotate-45">+</span>
                {f.q}
              </summary>
              <p className="m-0 pt-2 text-chip text-mute [text-wrap:pretty]">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </Page>
  );
}
