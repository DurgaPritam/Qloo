"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { EXAMPLES, SHOWCASE } from "@/lib/examples";

import { OverlapForm, overlapHref, PAIRS } from "./tools/fan-overlap";

import { AppHeader, Chip, InputBar, MonoLabel, Page, SourceBadge } from "./ui";

const STEPS = [
  { n: "01", title: "Crossover partner", body: "The artist, show, podcast or brand whose fans over-index on yours, from another category." },
  { n: "02", title: "City", body: "Where both audiences are strongest together, not just where the most people live." },
  { n: "03", title: "Room & sponsors", body: "A venue, a local opener, after-show spots and brands that already resonate with the crowd." },
  { n: "04", title: "Brief & outreach", body: "A one-page brief with every source, and two emails ready to review and send." },
];

/** One door per kind of user, each into its own tool, with a real example to open. */
const AUDIENCES = [
  {
    who: "Promoters & talent teams",
    title: "Plan a takeover",
    body: "A crossover partner, the city, the room, sponsors, a brief and the outreach for any fanbase.",
    href: "/run?q=John%20Mulaney",
    cta: "See John Mulaney's plan",
  },
  {
    who: "Anyone curious",
    title: "Fan overlap",
    body: "Any two names. How much their fans overlap, where, and who those fans are.",
    href: "/overlap?a=Phoebe%20Bridgers&b=PEN15",
    cta: "Try Phoebe Bridgers × PEN15",
  },
  {
    who: "Brands & agencies",
    title: "Brand match",
    body: "The artists, people, podcasts and shows your customers over-index on, and where they are.",
    href: "/brand?brand=Patagonia",
    cta: "Try Patagonia",
  },
  {
    who: "Venues & festivals",
    title: "Venue booker",
    body: "The artists, stand-up comedians and podcasts your city loves, ready to book.",
    href: "/venue?city=Austin",
    cta: "Try Austin",
  },
  {
    who: "Tour planners & fan clubs",
    title: "City explorer",
    body: "A fanbase's strongest cities at home and in three more countries, on one map.",
    href: "/cities?q=Taylor%20Swift",
    cta: "Try Taylor Swift",
  },
  {
    who: "Artists & agents",
    title: "Tour planner",
    body: "A tour through a fanbase's strongest cities, in driving order, with every leg's distance.",
    href: "/tour?q=Phoebe%20Bridgers",
    cta: "Try Phoebe Bridgers",
  },
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
    q: "Does it send the emails?",
    a: "No. The emails are drafts. Open one in your mail app, edit it and send it yourself.",
  },
  {
    q: "What are the other tools?",
    a: "More ways in: check two fanbases' overlap, start from a brand, a city, a fanbase's map or a tour route. Every result links straight to a full takeover plan.",
  },
  {
    q: "Is it free?",
    a: "Yes. Each visitor gets five live plans and thirty lookups an hour; the example plans are always instant.",
  },
];

export function Landing({ showcase }: { showcase?: ReactNode }) {
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
          Type a comedian, a band, a film, a podcast or a team. Takeover finds the crossover partner, the city, the room
          and the sponsors, then writes the brief and the outreach.
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
      </section>

      <section className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
        <MonoLabel>Who it&apos;s for</MonoLabel>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]">
          {AUDIENCES.map((a) => (
            <Link
              key={a.title}
              href={a.href}
              className="flex flex-col gap-1.5 rounded-md bg-surf p-panel text-ink no-underline hover:bg-acc-soft"
            >
              <div className="font-mono text-label uppercase tracking-[0.08em] text-acc-text">{a.who}</div>
              <div className="t-display text-[22px] leading-[1.05]">{a.title}</div>
              <div className="text-chip text-mute [text-wrap:pretty]">{a.body}</div>
              <div className="mt-auto pt-1 text-chip font-medium">{a.cta} →</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-[18px]">
        <div className="flex flex-col gap-1.5">
          <MonoLabel>Fan overlap</MonoLabel>
          <h2 className="t-display m-0 text-[clamp(24px,3.5vw,32px)] leading-[0.95]">Would these fans mix?</h2>
          <p className="m-0 text-body text-mute">Any two names. Qloo says how much their fans overlap and where.</p>
        </div>
        <OverlapForm onSubmit={(a, b) => startNavigation(() => router.push(overlapHref(a, b)))} />
        <div className="flex flex-wrap items-center gap-2">
          {PAIRS.slice(0, 3).map(([a, b]) => (
            <Chip key={a + b} label={`${a} × ${b}`} onClick={() => startNavigation(() => router.push(overlapHref(a, b)))} />
          ))}
        </div>
      </section>

      {showcase}

      <section className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
        <MonoLabel>What you get</MonoLabel>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr))]">
          {STEPS.map((s) => (
            <div key={s.n} className="flex flex-col gap-1.5 rounded-md bg-surf p-panel">
              <div className="font-mono text-label uppercase tracking-[0.08em] text-acc-text">Step {s.n}</div>
              <div className="text-body font-medium">{s.title}</div>
              <div className="text-chip text-mute [text-wrap:pretty]">{s.body}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <SourceBadge />
          <p className="m-0 text-body [text-wrap:pretty]">
            Every pick is backed by Qloo taste data. Nothing Qloo doesn&apos;t know is invented.{" "}
            <Link href="/method">How the scores work</Link>
          </p>
        </div>
      </section>

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
