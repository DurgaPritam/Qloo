"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { briefCsv, briefOutline, briefText, type CampaignBriefData } from "@/lib/campaign/brief";

import { FIELD } from "../account/fields";
import { Banner, Button, ConfirmPill, cx, MonoLabel, OutlineChip, Panel, Segmented, YourDataBadge } from "../ui";

/** Campaign brief (design: CampaignBrief): a targeting brief from a plan or a fanbase alone. */
type Choice = { entityId: string; name: string; detail?: string };

export function NewBrief({ plans }: { plans: { id: string; label: string }[] }) {
  const router = useRouter();
  const [from, setFrom] = useState<"plan" | "fanbase">(plans.length ? "plan" : "fanbase");
  const [f, setF] = useState({ planId: plans[0]?.id ?? "", query: "", title: "", flight: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ question: string; list: Choice[] } | null>(null);

  const make = async (entityId?: string) => {
    setBusy(true);
    setError(null);
    const body = from === "plan" ? { planId: f.planId, title: f.title, flight: f.flight } : { query: f.query, entityId, title: f.title, flight: f.flight };
    const res = await fetch("/api/workspace/briefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { status?: string; id?: string; error?: string; question?: string; choices?: Choice[] };
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "That didn't work.");
    if (data.status === "choose") return setChoices({ question: data.question ?? "Which one?", list: data.choices ?? [] });
    if (data.status === "none") return setError(`Qloo has no fanbase matching “${f.query}”.`);
    router.push(`/workspace/campaign/${data.id}`);
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel>New brief</MonoLabel>
        <Segmented
          label="Brief from"
          options={[
            { value: "plan", label: "A plan" },
            { value: "fanbase", label: "A fanbase alone" },
          ]}
          value={from}
          onChange={(v) => {
            setFrom(v);
            setChoices(null);
          }}
        />
      </div>
      {error && <Banner tone="err">{error}</Banner>}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        {from === "plan" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-chip">Plan</span>
            <select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })} aria-label="Plan" className={cx(FIELD, "cursor-pointer")}>
              {plans.length ? (
                plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))
              ) : (
                <option value="">No plans in this workspace yet</option>
              )}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-chip">Fanbase</span>
            <input value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} maxLength={100} placeholder="An artist, comedian, show, podcast or team" aria-label="Fanbase" className={FIELD} />
          </label>
        )}
        {choices && (
          <div className="flex flex-col gap-2" role="group" aria-label="Which one">
            <span className="text-chip">{choices.question}</span>
            <div className="flex flex-wrap gap-2">
              {choices.list.map((c) => (
                <Button key={c.entityId} onClick={() => void make(c.entityId)}>
                  {c.name}
                  {c.detail ? ` · ${c.detail}` : ""}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
          {(
            [
              ["title", "Campaign name", "Optional, e.g. Late Set, spring 2027"],
              ["flight", "Flight", "Optional, e.g. March to April 2027"],
            ] as const
          ).map(([key, name, hint]) => (
            <label key={key} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-chip">
                {name} <YourDataBadge />
              </span>
              <input value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} maxLength={120} placeholder={hint} aria-label={name} className={FIELD} />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={busy} disabled={from === "plan" ? !f.planId : !f.query.trim()} className="min-h-[44px] px-4">
            Make the brief
          </Button>
          <span className="text-chip text-mute">Uses up to 8 Qloo calls: audience, one per interest category, and cities for a fanbase alone. No reach, impressions, CPM or budget figures.</span>
        </div>
      </form>
    </Panel>
  );
}

const two = (x: number) => x.toFixed(2);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "brief";

export function BriefView({ id, brief, workspace, canDelete }: { id: string; brief: CampaignBriefData; workspace: string; canDelete: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [deck, setDeck] = useState(false);
  const b = brief;
  const a = b.audience;
  const tiles = a
    ? [
        { v: a.skewsTo[0] ?? "—", k: "Core age band" },
        { v: a.skewsTo[1] ?? "—", k: "Next age band" },
        { v: a.gender === "balanced" ? "Balanced" : `${a.genderSkew > 0 ? "+" : ""}${two(a.genderSkew)}`, k: a.gender === "balanced" ? "Gender" : `Skews ${a.gender}` },
      ]
    : [];
  const factsById = new Map(b.facts.map((f) => [f.id, f]));

  const downloadDeck = async () => {
    setDeck(true);
    try {
      const { renderDeck, loadBranding } = await import("../run/exports");
      await renderDeck(briefOutline(b), { title: b.title, footer: b.mock ? "Sample data, not Qloo results" : "Figures from Qloo taste data, computed by Takeover.", mock: b.mock, fileName: `${slug(b.title)}.pptx`, branding: await loadBranding() });
    } finally {
      setDeck(false);
    }
  };
  const downloadCsv = async () => {
    const { save } = await import("../run/exports");
    save(new Blob([briefCsv(b)], { type: "text/csv;charset=utf-8" }), `${slug(b.title)}-keywords-cities.csv`);
  };

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
          <Button onClick={() => void downloadDeck()} loading={deck}>
            Download deck
          </Button>
          <Button onClick={() => void downloadCsv()}>Keywords and cities CSV</Button>
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

      <article
        data-print-page
        aria-label="Brief"
        className="flex w-full max-w-[720px] flex-col gap-5 self-center rounded-[4px] bg-paper p-[clamp(22px,6%,48px)] text-paper-ink shadow-card border-card border-ink print:shadow-none"
      >
        <div className="flex justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">
          <span>Campaign brief · {workspace}</span>
          <span>{day(b.createdAt)}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="t-display m-0 text-[clamp(26px,5vw,38px)] leading-[0.95] [text-wrap:balance]">{b.title}</h2>
          <p className="m-0 text-[13px] text-paper-mute [text-wrap:pretty]">
            Targeting brief for {b.fanbase.name} fans{b.source.kind === "plan" && b.partner ? `, from the plan with ${b.partner}` : ""}. Every figure is Qloo signal; there are no reach, impressions, CPM or budget figures.
          </p>
          <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px]">
            <YourDataBadge /> Flight: {b.flight ?? <ConfirmPill>to confirm</ConfirmPill>}
          </p>
        </div>

        <section className="flex flex-col gap-2 border-t border-paper-line pt-3" aria-label="Audience">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">Audience · Qloo demographics, {b.fanbase.name} fans</span>
          {a ? (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))]">
              {tiles.map((t) => (
                <div key={t.k} className="flex flex-col gap-0.5">
                  <span className="t-display text-[28px] leading-none">{t.v}</span>
                  <span className="text-[11.5px] text-paper-mute">{t.k}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px]" data-audience-fallback>
              <OutlineChip>No demographics</OutlineChip>
              {b.audienceFallback}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3 border-t border-paper-line pt-3" aria-label="Interests">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">Top interests by category · Qloo affinity among the fans (1 = strongest)</span>
          {b.interests.map((g) => (
            <div key={g.category} className="flex flex-col gap-1.5" data-interest-group={g.label}>
              <span className="text-[12px] font-semibold">{g.label}</span>
              {g.items.map((i) => (
                <div key={i.id} className="grid grid-cols-[minmax(0,12em)_minmax(0,1fr)_3.5em] items-center gap-2.5 text-[12.5px]" data-interest={i.name}>
                  <span className="[overflow-wrap:anywhere]">{i.name}</span>
                  <span className="h-1.5 overflow-hidden rounded-pill bg-paper-line">
                    <span className="block h-full rounded-pill bg-acc-line" style={{ width: `${Math.round(i.affinity * 100)}%` }} />
                  </span>
                  <span className="tabular text-right font-mono text-[11px]">{two(i.affinity)}</span>
                </div>
              ))}
            </div>
          ))}
        </section>

        <section className="flex flex-col border-t border-paper-line pt-3" aria-label="Cities">
          <span className="pb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">Strongest cities</span>
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

        <section className="flex flex-col gap-2 border-t border-paper-line pt-3" aria-label="Keywords">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">Interest keywords for ad platforms</span>
          {b.keywords.map((k) => (
            <div key={k.group} className="flex flex-col gap-1 text-[12.5px]" data-keywords={k.group}>
              <span className="font-semibold">{k.group}</span>
              <span className="text-paper-mute">{k.keywords.join(" · ")}</span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2 border-t border-paper-line pt-3" aria-label="Creative angles">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">Creative angles</span>
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr))]">
            {b.angles.map((x, i) => (
              <div key={x.title} className="flex flex-col gap-1 rounded-md border-th border-paper-line p-3" data-angle={x.by}>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-acc-text">
                  Angle {String(i + 1).padStart(2, "0")}
                  {x.by === "template" ? " · template" : ""}
                </span>
                <span className="text-[13px] font-semibold">{x.title}</span>
                <span className="text-[11.5px] text-paper-mute [text-wrap:pretty]">{x.body}</span>
                <span className="font-mono text-[10px] text-paper-mute">◆ {x.facts.map((f) => factsById.get(f)?.id).join(", ")}</span>
              </div>
            ))}
          </div>
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-[11px] text-paper-mute" aria-label="Facts">
            {b.facts.map((f) => (
              <li key={f.id}>
                {f.id}. {f.text}
              </li>
            ))}
          </ol>
        </section>
        <div className="border-t border-paper-line pt-2.5 text-[10.5px] text-paper-mute">
          Sources: {b.sources.map((s) => `${s.figure}: ${s.endpoint}`).join("; ") || "the plan's Qloo requests"}
          {b.source.kind === "plan" ? "; cities from the plan's Qloo heatmaps" : ""}. Angles are written from the facts above, or from a template where marked.
        </div>
      </article>
    </div>
  );
}
