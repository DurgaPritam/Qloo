"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { briefText, type CampaignBriefData } from "@/lib/campaign/brief";

import { FIELD } from "../account/fields";
import { Banner, Button, ConfirmPill, cx, MonoLabel, Panel, YourDataBadge } from "../ui";

/** Campaign brief (design: CampaignBrief): make one from a plan, then read, print or copy it. */
export function NewBrief({ plans }: { plans: { id: string; label: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ planId: plans[0]?.id ?? "", title: "", flight: "", budget: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/workspace/briefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { id?: string; error?: string };
    setBusy(false);
    if (!res?.ok || !data.id) return setError(data.error ?? "That didn't work.");
    router.push(`/workspace/campaign/${data.id}`);
  };
  return (
    <Panel>
      <MonoLabel>New brief</MonoLabel>
      {error && <Banner tone="err">{error}</Banner>}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-chip">Plan</span>
          <select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })} aria-label="Plan" className={cx(FIELD, "cursor-pointer")}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
          {(
            [
              ["title", "Campaign name", "Optional, e.g. Late Set, spring 2027"],
              ["flight", "Flight", "Optional, e.g. March to April 2027"],
              ["budget", "Budget", "Optional"],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-chip">
                {label} <YourDataBadge />
              </span>
              <input value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} maxLength={120} placeholder={hint} aria-label={label} className={FIELD} />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={busy} disabled={!f.planId} className="min-h-[44px] px-4">
            Make the brief
          </Button>
          <span className="text-chip text-mute">Uses up to 2 Qloo calls (audience). Everything else is the plan&apos;s own Qloo data.</span>
        </div>
      </form>
    </Panel>
  );
}

const two = (x: number) => x.toFixed(2);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function BriefView({ id, brief, workspace, canDelete }: { id: string; brief: CampaignBriefData; workspace: string; canDelete: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const b = brief;
  const tiles = [
    ...b.audience.flatMap((a) => [
      { v: a.skewsTo[0] ?? "—", k: `Core age band · ${a.of} fans` },
      { v: a.gender === "balanced" ? "Balanced" : `${a.genderSkew > 0 ? "+" : ""}${two(a.genderSkew)}`, k: a.gender === "balanced" ? `Gender · ${a.of} fans` : `Skews ${a.gender} · ${a.of} fans` },
    ]),
    ...(b.partner && b.partnerAffinity !== null ? [{ v: two(b.partnerAffinity), k: `${b.fanbase} fans' affinity for ${b.partner}` }] : []),
  ].slice(0, 5);
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <section className="flex flex-col gap-1.5">
          <MonoLabel>Tools</MonoLabel>
          <h1 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">Campaign brief</h1>
        </section>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => window.print()}>
            Download PDF
          </Button>
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(briefText(b, workspace)).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy as text"}
          </Button>
          {canDelete && (
            <Button
              onClick={async () => {
                await fetch(`/api/workspace/briefs?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
                router.push("/workspace/campaign");
                router.refresh();
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      {b.mock && <Banner tone="warn">Sample data: this brief was made in sample mode, not from Qloo.</Banner>}

      <article data-print-page aria-label="Brief" className="flex w-full max-w-[720px] flex-col gap-5 self-center rounded-[4px] bg-paper p-[clamp(22px,6%,48px)] text-paper-ink shadow-card border-card border-ink print:shadow-none">
        <div className="flex justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">
          <span>Campaign brief · {workspace}</span>
          <span>{day(b.createdAt)}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="t-display m-0 text-[clamp(26px,5vw,38px)] leading-[0.95] [text-wrap:balance]">{b.title}</h2>
          <p className="m-0 text-[13px] text-paper-mute [text-wrap:pretty]">Every figure below is Qloo signal from the plan unless marked as your data. Venue, capacity, dates and prices stay to confirm with the promoter.</p>
          <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px]">
            <YourDataBadge /> Flight: {b.yours.flight ?? <ConfirmPill>to confirm</ConfirmPill>} · Budget: {b.yours.budget ?? <ConfirmPill>to confirm</ConfirmPill>}
          </p>
        </div>

        <section className="flex flex-col gap-2 border-t border-paper-line pt-3" aria-label="Audience">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">Audience · Qloo demographics</span>
          {tiles.length ? (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))]">
              {tiles.map((t) => (
                <div key={t.k} className="flex flex-col gap-0.5">
                  <span className="t-display text-[28px] leading-none">{t.v}</span>
                  <span className="text-[11.5px] text-paper-mute">{t.k}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12.5px] text-paper-mute">Qloo had no demographics for this audience.</span>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-paper-line pt-3" aria-label="Interests">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">Interests · Qloo affinity among {b.fanbase} fans (1 = strongest)</span>
          {b.interests.map((i) => (
            <div key={i.name} className="grid grid-cols-[minmax(0,12em)_minmax(0,1fr)_3.5em] items-center gap-2.5 text-[12.5px]" data-interest={i.name}>
              <span className="[overflow-wrap:anywhere]">
                {i.name} <span className="text-paper-mute">· {i.category}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-pill bg-paper-line">
                <span className="block h-full rounded-pill bg-acc-line" style={{ width: `${Math.round(i.affinity * 100)}%` }} />
              </span>
              <span className="tabular text-right font-mono text-[11px]">{two(i.affinity)}</span>
            </div>
          ))}
        </section>

        <section className="flex flex-col border-t border-paper-line pt-3" aria-label="Cities">
          <span className="pb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">Cities</span>
          {b.cities.map((c, i) => (
            <div key={c.name} className="grid grid-cols-[2em_minmax(0,1fr)_auto] gap-2.5 border-b border-paper-line py-1.5 text-[13px]">
              <span className="font-mono text-[11px] text-paper-mute">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex flex-col">
                <span className="font-semibold">{c.name}</span>
                <span className="text-[11.5px] text-paper-mute">
                  Qloo #{c.rank} · population #{c.populationRank}
                  {c.note ? ` · ${c.note}` : ""}
                </span>
              </span>
              <span className="tabular font-mono text-[11px]">{c.score} / 100</span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2 border-t border-paper-line pt-3" aria-label="Creative angles">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">Creative angles</span>
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr))]">
            {b.angles.map((a, i) => (
              <div key={a.title} className="flex flex-col gap-1 rounded-md border-th border-paper-line p-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-acc-text">Angle {String(i + 1).padStart(2, "0")}</span>
                <span className="text-[13px] font-semibold">{a.title}</span>
                <span className="text-[11.5px] text-paper-mute [text-wrap:pretty]">{a.body}</span>
                <span className="font-mono text-[10px] text-paper-mute">◆ {a.source}</span>
              </div>
            ))}
          </div>
        </section>
        <div className="border-t border-paper-line pt-2.5 text-[10.5px] text-paper-mute">
          Sources: Qloo /v2/insights from the plan (interests, cities){b.sources.length ? `; ${b.sources.map((s) => `${s.figure}: ${s.endpoint}`).join("; ")}` : ""}. Budget and flight are your data; dates to confirm.
        </div>
      </article>
    </div>
  );
}
