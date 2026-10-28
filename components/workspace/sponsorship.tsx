"use client";

import { useState } from "react";

import { describeRequest, type PitchInput } from "@/lib/export/sponsor";
import type { MatchView, SponsorRun } from "@/lib/sponsorship/service";

import { FIELD } from "../account/fields";
import { Banner, Button, ConfirmPill, cx, MonoLabel, Panel, ScoreBar, Segmented, SourceBadge } from "../ui";
import { AddToPipeline } from "./pipeline-add";

type View = "brand" | "rights";
type HolderKind = "entity" | "event" | "roster";
type Choice = { entityId: string; name: string; category: string; detail?: string };
export interface ShortlistRow {
  id: string;
  view: View;
  pitch: PitchInput;
  createdAt: string;
}

/** Upper bounds, from the code paths: search, lists, teams, heatmap, demographics, reverse checks. */
const ESTIMATE: Record<View | HolderKind, number> = { brand: 14, rights: 9, entity: 9, event: 1, roster: 1 };

async function send<T>(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  return { ok: Boolean(res?.ok), data: ((await res?.json().catch(() => null)) ?? { error: "That didn't work. Try again." }) as T & { error?: string } };
}

async function deck(p: PitchInput) {
  const [{ pitchOutline, pitchFooter, pitchFileName }, { renderDeck, loadBranding }] = await Promise.all([import("@/lib/export/sponsor"), import("../run/exports")]);
  await renderDeck(pitchOutline(p), { title: `${p.holder} × ${p.brand}`, footer: pitchFooter(p), mock: p.mock, fileName: pitchFileName(p), branding: await loadBranding() });
}

export function SponsorshipScreen({
  canEdit,
  plans,
  rosters,
  initialShortlist,
}: {
  canEdit: boolean;
  plans: { id: string; label: string }[];
  rosters: { id: string; name: string; acts: number }[];
  initialShortlist: ShortlistRow[];
}) {
  const [view, setView] = useState<View>("brand");
  const [kind, setKind] = useState<HolderKind>("entity");
  const [q, setQ] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [rosterId, setRosterId] = useState(rosters[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ question: string; list: Choice[] } | null>(null);
  const [result, setResult] = useState<Extract<SponsorRun, { status: "done" }> | null>(null);
  const [shortlist, setShortlist] = useState(initialShortlist);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const run = async (entityId?: string, name?: string) => {
    setBusy(true);
    setError(null);
    setChoices(null);
    const body =
      view === "brand"
        ? { view, query: name ?? q, entityId }
        : { view, holder: kind === "entity" ? { kind, query: name ?? q, entityId } : kind === "event" ? { kind, planId } : { kind, rosterId } };
    const { ok, data } = await send<SponsorRun>("/api/workspace/sponsorship", "POST", body);
    setBusy(false);
    if (!ok) return setError(data.error ?? "That didn't work.");
    if (data.status === "choose") return setChoices({ question: data.question, list: data.choices });
    if (data.status === "none") return setError(view === "brand" ? `Qloo has no brand matching “${q}”.` : `Qloo has no entity matching “${q}”.`);
    setResult(data);
    setSaved(new Set());
  };

  const save = async (m: MatchView) => {
    if (!result) return;
    const { ok, data } = await send<{ id: string }>("/api/workspace/sponsorship/shortlist", "POST", { draftId: result.draftId, key: m.key });
    if (!ok) return setError(data.error ?? "That didn't work.");
    setSaved(new Set([...saved, m.key]));
    const list = await send<{ shortlist: (ShortlistRow & { createdAt: string })[] }>("/api/workspace/sponsorship/shortlist", "GET");
    if (list.ok) setShortlist(list.data.shortlist);
  };

  const ready = view === "brand" ? q.trim() : kind === "entity" ? q.trim() : kind === "event" ? planId : rosterId;
  const estimate = view === "brand" ? ESTIMATE.brand : ESTIMATE[kind];

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <MonoLabel>Sponsorship</MonoLabel>
          <h2 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">{view === "brand" ? "Brand view" : "Rights-holder view"}</h2>
        </div>
        <Segmented
          label="View"
          options={[
            { value: "brand", label: "Brand view" },
            { value: "rights", label: "Rights-holder view" },
          ]}
          value={view}
          onChange={(v) => {
            setView(v);
            setResult(null);
            setChoices(null);
            setError(null);
          }}
        />
      </div>

      {canEdit ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void run();
          }}
        >
          <MonoLabel>{view === "brand" ? "Brand" : "Representing"}</MonoLabel>
          {view === "rights" && (
            <Segmented
              label="Rights holder"
              options={[
                { value: "entity", label: "Act or team" },
                { value: "event", label: "Event" },
                { value: "roster", label: "Roster" },
              ]}
              value={kind}
              onChange={setKind}
            />
          )}
          {(view === "brand" || kind === "entity") && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={view === "brand" ? "A brand, e.g. Liquid Death" : "An act or team, e.g. Ali Wong"}
              aria-label={view === "brand" ? "Brand" : "Act or team"}
              maxLength={100}
              className={cx(FIELD, "min-w-0 flex-1 basis-[220px]")}
            />
          )}
          {view === "rights" && kind === "event" && (
            <select aria-label="Event" value={planId} onChange={(e) => setPlanId(e.target.value)} className={cx(FIELD, "min-w-0 flex-1 basis-[220px] cursor-pointer")}>
              {plans.length ? plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>) : <option value="">No finished plans in this workspace yet</option>}
            </select>
          )}
          {view === "rights" && kind === "roster" && (
            <select aria-label="Roster" value={rosterId} onChange={(e) => setRosterId(e.target.value)} className={cx(FIELD, "min-w-0 flex-1 basis-[220px] cursor-pointer")}>
              {rosters.length ? rosters.map((r) => <option key={r.id} value={r.id}>{`${r.name} (${r.acts} acts)`}</option>) : <option value="">No rosters yet</option>}
            </select>
          )}
          <Button type="submit" variant="primary" loading={busy} disabled={!ready} className="min-h-[44px] px-4">
            {view === "brand" ? "Find talent" : "Find brands"}
          </Button>
          <span className="w-full text-chip text-mute">Uses up to {estimate} Qloo calls from this workspace&apos;s allowance. Cached answers are free.</span>
        </form>
      ) : (
        <Banner tone="neutral">Your role can view the shortlist. Members run sponsorship searches.</Banner>
      )}

      {error && <Banner tone="err">{error}</Banner>}
      {choices && (
        <div className="flex flex-col gap-1.5">
          <span className="text-chip text-mute">{choices.question}</span>
          <div className="flex flex-wrap gap-1.5">
            {choices.list.map((c) => (
              <Button key={c.entityId} variant="pick" onClick={() => void run(c.entityId, c.name)}>
                {c.name} · {c.category.replace("_", " ")}
              </Button>
            ))}
          </div>
        </div>
      )}

      {result && (
        <section className="flex flex-col gap-3" aria-label="Matches">
          <p className="m-0 text-chip text-mute">
            <strong className="text-ink">{result.subject.name}</strong> · {result.subject.meta}
          </p>
          {result.notes.map((n) => (
            <Banner key={n} tone="neutral">
              {n}
            </Banner>
          ))}
          {result.groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-2">
              {result.view === "rights" && <MonoLabel>{g.label}</MonoLabel>}
              {g.matches.map((m) => (
                <MatchCard key={m.key} m={m} canEdit={canEdit} saved={saved.has(m.key)} onSave={() => void save(m)} />
              ))}
            </div>
          ))}
          <span className="text-chip text-mute">
            Pitch decks use the house style (branded deck settings are not set up yet) and include the evidence above with its Qloo source. Reach, impressions and fees are
            always to confirm.
          </span>
        </section>
      )}

      <Shortlist rows={shortlist} canEdit={canEdit} onRemoved={(id) => setShortlist(shortlist.filter((r) => r.id !== id))} />
    </div>
  );
}

function MatchCard({ m, canEdit, saved, onSave }: { m: MatchView; canEdit: boolean; saved: boolean; onSave: () => void }) {
  const [building, setBuilding] = useState(false);
  return (
    <article className="grid gap-[18px] rounded-lg bg-surf p-panel border-card border-ink shadow-card md:grid-cols-2" data-match={m.name}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="font-mono text-label uppercase tracking-[0.08em] text-acc-text">{m.kind}</span>
        <span className="t-display text-[28px] leading-none [overflow-wrap:anywhere]">{m.name}</span>
        <span className="text-chip text-mute">{m.meta}</span>
        <div className="mt-2 flex flex-col gap-1">
          <MonoLabel>Fit score</MonoLabel>
          <ScoreBar value={m.fit.fit} label={`${m.fit.fit} / 100`} />
          <span className="font-mono text-label uppercase tracking-[0.06em] text-mute">{m.fit.confidence} confidence</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <MonoLabel>Evidence</MonoLabel>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={`Evidence for ${m.name}`}>
          {m.fit.evidence.map((e) => (
            <li key={e.text} className="flex gap-2 text-body">
              <span className={e.source === "qloo" ? "text-acc-text" : "text-mute"}>{e.source === "qloo" ? "◆" : "·"}</span>
              {e.kind === "to_confirm" ? <ConfirmPill>{e.text}</ConfirmPill> : <span>{e.text}</span>}
            </li>
          ))}
        </ul>
        {m.pitch.sources && m.pitch.sources.length > 0 && (
          <details className="text-chip">
            <summary className="cursor-pointer text-acc-text">Where each figure comes from</summary>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 pt-1.5" aria-label={`Sources for ${m.name}`}>
              {m.pitch.sources.map((s) => (
                <li key={s.figure} className="flex flex-col">
                  <span>{s.figure}</span>
                  <span className="font-mono text-label text-mute [overflow-wrap:anywhere]">{describeRequest(s)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <SourceBadge />
          <span className="flex-1" />
          {canEdit && (
            <Button onClick={onSave} disabled={saved}>
              {saved ? "On the shortlist" : "Save to shortlist"}
            </Button>
          )}
          <Button
            variant="primary"
            loading={building}
            onClick={async () => {
              setBuilding(true);
              try {
                await deck(m.pitch);
              } finally {
                setBuilding(false);
              }
            }}
          >
            Make pitch deck
          </Button>
        </div>
      </div>
    </article>
  );
}

function Shortlist({ rows, canEdit, onRemoved }: { rows: ShortlistRow[]; canEdit: boolean; onRemoved: (id: string) => void }) {
  return (
    <Panel>
      <MonoLabel>Shortlist · {rows.length}</MonoLabel>
      {rows.length === 0 ? (
        <p className="m-0 text-chip text-mute">No matches saved yet. Save a match to keep it, with its evidence, for the team.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" aria-label="Shortlist">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line py-2.5" data-shortlist={`${r.pitch.holder} × ${r.pitch.brand}`}>
              <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
                {r.pitch.holder} × {r.pitch.brand}
              </span>
              <span className="tabular font-mono text-chip">{r.pitch.fit.fit} / 100</span>
              <Button onClick={() => void deck(r.pitch)}>Pitch deck</Button>
              {canEdit && <AddToPipeline matchId={r.id} label="Send to pipeline" />}
              {canEdit && (
                <Button
                  onClick={async () => {
                    await send(`/api/workspace/sponsorship/shortlist?id=${encodeURIComponent(r.id)}`, "DELETE");
                    onRemoved(r.id);
                  }}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <span className="text-chip text-mute">Send to pipeline adds a draft email to the brand, with no figures: terms stay to confirm. Takeover never sends it.</span>
    </Panel>
  );
}
