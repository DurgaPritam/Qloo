"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { LineupAct, LineupResult } from "@/lib/tools/lineup";

import { categoryLabel, pct } from "../run/format";
import { Banner, Button, MonoLabel, OutlineChip, Panel, Sk, SourceBadge, cx } from "../ui";
import { CallsUsed, ChoicePicker, SampleBanner, ToolError, ToolForm, ToolIntro, useToolQuery } from "./tool-kit";

const EXAMPLES = [{ label: "Phoebe Bridgers" }, { label: "John Mulaney" }, { label: "Bad Bunny" }, { label: "Black Country, New Road" }];
const MAX_ACTS = 4;

/** Same formula as the saved poster (lib/tools/lineup.ts crowdFit). */
const fit = (acts: readonly LineupAct[]) => {
  const a = acts.map((x) => x.affinity).filter(Number.isFinite);
  return a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 100) : 0;
};

export function LineupBuilder() {
  const router = useRouter();
  const { value, state, submit, pick, retry } = useToolQuery<LineupResult>("/api/tools/lineup", "h", (headliner, entityId) => ({
    headliner,
    entityId,
  }));
  const r = state.data;
  const [picked, setPicked] = useState<{ draft: string; acts: string[]; host: string | null }>({ draft: "", acts: [], host: null });
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = r?.status === "done" ? r : null;
  // A new draft starts with the top three acts and the top host picked.
  const sel =
    draft && picked.draft !== draft.draftId
      ? { draft: draft.draftId, acts: draft.acts.slice(0, 3).map((a) => a.id), host: draft.hosts[0]?.id ?? null }
      : picked;
  const chosenActs = draft ? sel.acts.map((id) => draft.acts.find((a) => a.id === id)!).filter(Boolean) : [];
  const chosenHost = draft?.hosts.find((h) => h.id === sel.host) ?? null;
  const score = fit(chosenHost ? [...chosenActs, chosenHost] : chosenActs);

  const toggleAct = (id: string) => {
    const acts = sel.acts.includes(id) ? sel.acts.filter((x) => x !== id) : sel.acts.length < MAX_ACTS ? [...sel.acts, id] : sel.acts;
    setPicked({ ...sel, acts });
  };
  const toggleHost = (id: string) => setPicked({ ...sel, host: sel.host === id ? null : id });

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/tools/lineup/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: draft.draftId, actIds: sel.acts, hostId: sel.host, title }),
    }).catch(() => null);
    const body = res ? ((await res.json()) as { id?: string; error?: string }) : null;
    setSaving(false);
    if (res?.ok && body?.id) router.push(`/lineup/${body.id}`);
    else setError(body?.error ?? "The poster could not be saved. Try again.");
  };

  return (
    <>
      <ToolIntro
        label="Lineup builder"
        title="Build a lineup the crowd will love"
        body="Pick a headliner. Qloo suggests support acts and a host the headliner's fans over-index on, plus the city and venue. Choose up to four acts, watch the crowd fit, and get a poster to share."
      />
      <ToolForm initial={value} placeholder="A headliner, e.g. Phoebe Bridgers" button="Suggest a lineup" examples={EXAMPLES} onSubmit={submit} busy={state.loading} />

      {state.error && <ToolError message={state.error} onRetry={retry} />}
      {state.loading && <Sk.block />}
      {r?.status === "none" && <Banner tone="neutral">We couldn&apos;t find “{value}”. Try one of the examples.</Banner>}
      {r?.status === "choose" && <ChoicePicker question={r.question} choices={r.choices} onPick={pick} />}
      {draft && (
        <>
          <SampleBanner mock={draft.mock} />
          <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-[18px]">
              <Panel>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <MonoLabel className="text-acc-text">
                    Support acts · {sel.acts.length} / {MAX_ACTS}
                  </MonoLabel>
                  <SourceBadge>urn:entity:artist</SourceBadge>
                </div>
                <Choices items={draft.acts} selected={sel.acts} onToggle={toggleAct} full={sel.acts.length >= MAX_ACTS} />
              </Panel>
              <Panel>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <MonoLabel className="text-acc-text">Host</MonoLabel>
                  <SourceBadge>urn:entity:person</SourceBadge>
                </div>
                <Choices items={draft.hosts} selected={sel.host ? [sel.host] : []} onToggle={toggleHost} />
              </Panel>
            </div>

            <Panel className="lg:sticky lg:top-4">
              <MonoLabel className="text-acc-text">Poster preview</MonoLabel>
              <div className="flex aspect-[4/5] flex-col justify-between gap-3 rounded-md border-[6px] border-ink bg-[#f4eee0] p-5 text-center text-[#1d1b26]">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.12em]">
                  <span>Takeover presents</span>
                  <span>Powered by Qloo</span>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="font-mono text-[12px] uppercase tracking-[0.14em]">{title.trim() || `${draft.headliner.name} & Friends`}</div>
                  <div className="t-display text-[clamp(30px,4vw,46px)] leading-[0.95] [overflow-wrap:anywhere]">{draft.headliner.name}</div>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[15px] font-bold uppercase">
                    {chosenActs.map((a) => (
                      <span key={a.id}>{a.name}</span>
                    ))}
                  </div>
                  {chosenHost && <div className="text-[13px]">Hosted by {chosenHost.name}</div>}
                </div>
                <div className="flex items-end justify-between text-left">
                  <div className="flex flex-col text-[12px] uppercase">
                    <span>{draft.venue ?? ""}</span>
                    <span className="font-bold">{draft.city?.name ?? ""}</span>
                    <span className="text-[10px]">Dates to confirm with the promoter</span>
                  </div>
                  <div className="flex flex-col items-center border-4 border-ink bg-acc px-3 py-1.5">
                    <span className="t-display text-[30px] leading-none">{score}</span>
                    <span className="font-mono text-[9px] tracking-[0.1em]">CROWD FIT</span>
                  </div>
                </div>
              </div>
              <p className="m-0 text-chip text-mute">
                Crowd fit is the average Qloo affinity of your picks among {draft.headliner.name} fans, 0–100.
              </p>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={40}
                placeholder={`Event name, e.g. ${draft.headliner.name} & Friends`}
                aria-label="Event name"
                className="rounded-btn border-th border-line bg-bg px-3 py-2 font-body text-body text-ink"
              />
              {error && <p className="m-0 text-chip text-err">{error}</p>}
              <Button variant="primary" loading={saving} disabled={!sel.acts.length} onClick={save} className="py-2.5 text-body">
                Save and share the poster
              </Button>
              <div className="flex flex-wrap gap-1.5">
                {draft.city && <OutlineChip>Qloo&apos;s #1 city · {draft.city.name}</OutlineChip>}
                {draft.venue && <OutlineChip>Venue · {draft.venue}</OutlineChip>}
              </div>
            </Panel>
          </div>
          <CallsUsed calls={draft.calls} />
        </>
      )}
    </>
  );
}

function Choices({ items, selected, onToggle, full }: { items: LineupAct[]; selected: string[]; onToggle: (id: string) => void; full?: boolean }) {
  if (!items.length) return <p className="m-0 text-chip text-mute">Qloo had no suggestions here.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((a) => {
        const on = selected.includes(a.id);
        return (
          <button
            key={a.id}
            type="button"
            aria-pressed={on}
            disabled={!on && full}
            onClick={() => onToggle(a.id)}
            className={cx(
              "flex cursor-pointer items-center justify-between gap-2 rounded-md border-th bg-bg px-3.5 py-2.5 text-left font-body text-ink disabled:cursor-default disabled:opacity-50",
              on ? "border-acc-line bg-acc-soft" : "border-line hover:bg-acc-soft",
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-body font-medium [overflow-wrap:anywhere]">
                {on ? "✓ " : ""}
                {a.name}
              </span>
              <span className="text-chip text-mute">
                {categoryLabel(a.category)} · affinity {a.affinity.toFixed(2)}
              </span>
            </span>
            <span className="tabular flex-none font-mono text-chip text-mute">{pct(a.score)}</span>
          </button>
        );
      })}
    </div>
  );
}
