"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { EXAMPLES, SHOWCASE } from "@/lib/examples";

import { AppHeader, Chip, InputBar, Page, Segmented, SourceBadge } from "./ui";

const STEPS = [
  { n: "01", title: "Crossover partner", body: "Whose fans over-index on yours." },
  { n: "02", title: "City", body: "Where both audiences are strongest." },
  { n: "03", title: "Venue & sponsors", body: "A room, an opener and brands that fit." },
  { n: "04", title: "Brief & outreach", body: "A sourced brief and two email drafts." },
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

/** The landing page is wider than the rest of the site: a two-column hero and boxes, not a column of text. */
const WIDE = "max-w-[1240px]";

export function Landing({ hero, showcase, roles }: { hero?: ReactNode; showcase?: ReactNode; roles?: ReactNode }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Busy only while the navigation is in flight. A flag set by hand would survive a Back
  // navigation (Next keeps the previous page's state) and leave the button disabled.
  const [busy, startNavigation] = useTransition();
  // Big names may not need a crossover: the user chooses whether to look for a partner at all.
  const [mode, setMode] = useState<"crossover" | "solo">("crossover");
  const plan = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    startNavigation(() => router.push(`/run?q=${encodeURIComponent(trimmed)}${mode === "solo" ? "&solo=1" : ""}`));
  };

  return (
    <Page max={WIDE}>
      <AppHeader right={<div className="hidden font-mono text-label uppercase tracking-[0.08em] text-mute sm:block">Powered by Qloo</div>} />

      <section className="grid items-center gap-x-12 gap-y-10 pb-6 pt-[clamp(20px,6vh,64px)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <h1 className="t-display m-0 text-[clamp(44px,7.4vw,96px)] leading-[0.88] [text-wrap:balance]">
            <span className="rise block">Pick a talent.</span>
            <span className="rise block" style={{ ["--d" as string]: "90ms" }}>
              Find the city.
            </span>
            <span className="rise block text-acc-text" style={{ ["--d" as string]: "180ms" }}>
              Get the plan.
            </span>
          </h1>
          <p className="rise m-0 max-w-[46ch] text-[clamp(16px,1.5vw,19px)] leading-[1.45] text-mute [text-wrap:pretty]" style={{ ["--d" as string]: "260ms" }}>
            Any fanbase in. Partner, city, venue and brief out, with every number from Qloo taste data.
          </p>
          {/* Above the rows below it: each .rise is its own layer, and the suggestion list must sit on top. */}
          <div className="rise relative z-10" style={{ ["--d" as string]: "340ms" }}>
            <InputBar value={query} onChange={setQuery} onSubmit={() => plan(query)} onPick={plan} placeholder="Plan a takeover for…" busy={busy} />
          </div>
          <div className="rise flex flex-wrap items-center gap-2 text-chip text-mute" style={{ ["--d" as string]: "380ms" }}>
            <Segmented<"crossover" | "solo">
              label="Plan type"
              value={mode}
              onChange={setMode}
              options={[
                { value: "crossover", label: "With a crossover partner" },
                { value: "solo", label: "Solo, no partner" },
              ]}
            />
            <span>{mode === "solo" ? "City, venue and sponsors for the fanbase alone." : "Qloo finds the partner whose fans overlap most."}</span>
          </div>
          <div className="rise flex flex-wrap items-center gap-2" style={{ ["--d" as string]: "420ms" }}>
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
        </div>
        <div className="rise min-w-0" style={{ ["--d" as string]: "200ms" }}>
          {hero}
        </div>
      </section>

      <section className="reveal flex flex-col gap-5 border-t border-line pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="t-display m-0 text-[clamp(30px,4vw,48px)] leading-[0.92]">What you get</h2>
          <span className="flex items-center gap-2 text-[15px] text-mute">
            <SourceBadge /> Every pick from Qloo taste data. <Link href="/method">How scores work</Link>
          </span>
        </div>
        <ol className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="reveal lift flex flex-col gap-2 rounded-lg bg-surf p-panel border-card border-ink shadow-card">
              <div className="t-display text-[clamp(40px,5vw,56px)] leading-none text-acc-text">{s.n}</div>
              <div className="text-[clamp(16px,1.6vw,19px)] font-semibold">{s.title}</div>
              <div className="text-[15px] text-mute [text-wrap:pretty]">{s.body}</div>
            </li>
          ))}
        </ol>
      </section>

      {roles}

      {showcase}

      <section className="reveal flex flex-col gap-4 border-t border-line pb-[22px] pt-8">
        <h2 className="t-display m-0 text-[clamp(30px,4vw,48px)] leading-[0.92]">Questions</h2>
        <div className="grid gap-x-8 md:grid-cols-2">
          {FAQ.map((f) => (
            <details key={f.q} className="group border-b border-line py-4">
              <summary className="cursor-pointer list-none text-[17px] font-medium marker:hidden">
                <span className="mr-2 inline-block font-mono text-acc-text transition-transform group-open:rotate-45 motion-reduce:transition-none">+</span>
                {f.q}
              </summary>
              <p className="m-0 pt-2 text-[15px] text-mute [text-wrap:pretty]">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </Page>
  );
}
