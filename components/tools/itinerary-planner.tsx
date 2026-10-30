"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { itineraryCsv, itineraryFileName, itineraryIcs } from "@/lib/export/itinerary";
import { applyEdits, clampPace, type EditOp, type Rejected } from "@/lib/itinerary/edits";
import { itineraryFromTour } from "@/lib/itinerary/from-tour";
import { loadLocalItineraries, removeLocalItinerary, saveLocalItinerary, type LocalItinerary } from "@/lib/itinerary/local";
import { computeSchedule, DRAFT_LABEL, type Schedule, type ScheduleDay } from "@/lib/itinerary/schedule";
import { emptyStop, isIsoDate, ITINERARY_LIMITS, newId, type Contact, type Itinerary, type ItineraryStop, type Picked, type StopCity, type StopField } from "@/lib/itinerary/types";
import type { TourResult } from "@/lib/tools/tour";
import type { Suggestion, SuggestKind, SuggestResult } from "@/lib/tools/tour-suggest";

import { FIELD } from "../account/fields";
import { GeoMap } from "../geo-map";
import { categoryLabel, pct } from "../run/format";
import { Banner, Button, ConfirmPill, cx, MonoLabel, OutlineChip, Panel, ScoreBar, SourceBadge, YourDataBadge } from "../ui";
import { CallsUsed, ChoicePicker, SampleBanner, ToolError, ToolForm, ToolIntro } from "./tool-kit";
import { REGION_OPTIONS } from "./tour-planner";

/**
 * Tour planner: an editable itinerary from a Tour optimizer route. The user edits it by hand or
 * by typing an instruction (the model proposes checked edit ops; code applies them and recomputes
 * legs and the draft schedule). Qloo is asked about one stop at a time, only when clicked. Qloo
 * values keep their badge and evidence; everything typed is Your data; computed dates are drafts.
 */

const EXAMPLES = [{ label: "Phoebe Bridgers" }, { label: "John Mulaney" }, { label: "Call Her Daddy" }];
const AI_EXAMPLES = ["Add a rest day after the second stop", "Push everything back a week", "Move the first stop to the end"];

const FIELDS: { key: StopField; label: string; kind: SuggestKind; button: string }[] = [
  { key: "venue", label: "Venue", kind: "venue", button: "Suggest venue" },
  { key: "support", label: "Support act", kind: "support", button: "Suggest support act" },
  { key: "sponsor", label: "Sponsor", kind: "sponsor", button: "Suggest sponsors" },
];

type SuggestState = { loading: boolean; result?: SuggestResult; error?: string };
type AiState = { busy: boolean; summary?: string; labels?: string[]; rejected?: Rejected[]; fallback?: string; before?: Itinerary; error?: string };

const two = (n: number) => String(n).padStart(2, "0");
const km = (n: number) => `${n.toLocaleString("en-GB")} km`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function download(text: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ItineraryPlanner({
  workspace,
  opened,
  openedMissing,
  draft,
  draftExpired,
}: {
  workspace: { name: string; canSave: boolean; upgradeLabel: string | null; saved: { id: string; name: string; updatedAt: string }[] } | null;
  opened?: { id: string; itinerary: Itinerary; updatedAt: string };
  openedMissing?: boolean;
  draft?: Itinerary;
  draftExpired?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const localParam = params.get("local") ?? "";
  const [it, setIt] = useState<Itinerary | null>(opened?.itinerary ?? draft ?? null);
  const [past, setPast] = useState<Itinerary[]>([]);
  const [wsId, setWsId] = useState<string | null>(opened?.id ?? null);
  const [localKey, setLocalKey] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalItinerary[]>([]);
  const [dirty, setDirty] = useState(Boolean(draft));
  const [saving, setSaving] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null });
  const [localMissing, setLocalMissing] = useState(false);

  // Browser-kept itineraries exist only client side: read them after hydration.
  /* eslint-disable react-hooks/set-state-in-effect -- localStorage is read after mount */
  useEffect(() => {
    const list = loadLocalItineraries();
    setLocal(list);
    if (localParam && localParam !== localKey) {
      const found = list.find((x) => x.key === localParam);
      if (found) {
        setIt(found.itinerary);
        setLocalKey(found.key);
        setPast([]);
        setDirty(false);
      } else setLocalMissing(true);
    }
  }, [localParam, localKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Every change goes through here; `record` keeps the previous version for Undo. */
  const change = (next: Itinerary, record = true) => {
    if (record && it) setPast((p) => [...p.slice(-29), it]);
    setIt(next);
    setDirty(true);
    setSaving({ busy: false, text: null });
  };
  const undo = () => {
    const prev = past.at(-1);
    if (!prev) return;
    setPast(past.slice(0, -1));
    setIt(prev);
    setDirty(true);
  };

  const save = async () => {
    if (!it) return;
    if (workspace?.canSave) {
      setSaving({ busy: true, text: null });
      const res = await fetch(wsId ? `/api/workspace/itineraries?id=${wsId}` : "/api/workspace/itineraries", {
        method: wsId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itinerary: it }),
      }).catch(() => null);
      const data = ((await res?.json().catch(() => null)) ?? {}) as { id?: string; error?: string };
      if (res?.ok && data.id) {
        setWsId(data.id);
        setDirty(false);
        // Keeps the page's state; the address now opens this itinerary.
        window.history.replaceState(null, "", `/tour/planner?id=${data.id}`);
      }
      setSaving({ busy: false, text: res?.ok && data.id ? `Saved to ${workspace.name}.` : (data.error ?? "That didn't save. Try again.") });
      return;
    }
    const key = localKey ?? newId();
    const ok = saveLocalItinerary(key, it);
    if (ok) {
      setLocalKey(key);
      setLocal(loadLocalItineraries());
      setDirty(false);
      window.history.replaceState(null, "", `/tour/planner?local=${key}`);
    }
    setSaving({ busy: false, text: ok ? "Saved in this browser." : "This browser wouldn't store it (private mode or storage full)." });
  };

  const startOver = () => {
    setIt(null);
    setPast([]);
    setWsId(null);
    setLocalKey(null);
    setDirty(false);
    setLocalMissing(false);
    router.push("/tour/planner");
  };

  return (
    <>
      <div className="print:hidden">
        <ToolIntro
          label="Tools"
          title="Tour planner"
          body="Start from a route through a fanbase's strongest cities, then make it yours: dates from your start date, shows and rest days, venue, support act, sponsor and contacts for every stop. Edit any field, or type what to change. Qloo is asked about one stop at a time, when you click."
        />
      </div>
      {draftExpired && <Banner tone="warn">That route from the Tour optimizer has expired. Start a new plan below.</Banner>}
      {openedMissing && <Banner tone="warn">That tour isn&apos;t in this workspace.</Banner>}
      {localMissing && !it && <Banner tone="warn">That tour isn&apos;t saved in this browser.</Banner>}
      {it ? (
        <Editor
          it={it}
          change={change}
          undo={past.length ? undo : null}
          save={save}
          saving={saving}
          dirty={dirty}
          saveLabel={workspace?.canSave ? (wsId ? "Save changes" : `Save to ${workspace.name}`) : "Save in this browser"}
          upgradeNote={workspace && !workspace.canSave && workspace.upgradeLabel ? `Saving tours to ${workspace.name} comes with ${workspace.upgradeLabel}; this one is kept in this browser.` : null}
          startOver={startOver}
        />
      ) : (
        <Start
          onReady={(next) => {
            setPast([]);
            change(next, false);
          }}
          workspace={workspace}
          local={local}
          removeLocal={(key) => setLocal(removeLocalItinerary(key))}
        />
      )}
    </>
  );
}

/* ---------- Starting a plan ---------- */

function Start({
  onReady,
  workspace,
  local,
  removeLocal,
}: {
  onReady: (it: Itinerary) => void;
  workspace: { name: string; saved: { id: string; name: string; updatedAt: string }[] } | null;
  local: LocalItinerary[];
  removeLocal: (key: string) => void;
}) {
  const [fanbase, setFanbase] = useState("");
  const [region, setRegion] = useState("");
  const [stops, setStops] = useState(4);
  const [startDate, setStartDate] = useState("");
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: TourResult }>({ loading: false });

  const run = async (name: string, entityId?: string) => {
    const q = name.trim();
    if (!q) return;
    setFanbase(q);
    setState({ loading: true });
    try {
      const res = await fetch("/api/tools/tour", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fanbase: q, entityId, region, stops }) });
      const json = (await res.json()) as TourResult & { error?: string };
      if (!res.ok) return setState({ loading: false, error: json.error ?? "Something went wrong." });
      if (json.status === "done" && !json.route.infeasible) return onReady(itineraryFromTour(json, { startDate }));
      setState({ loading: false, data: json });
    } catch {
      setState({ loading: false, error: "Network error. Check your connection and try again." });
    }
  };
  const r = state.data;

  return (
    <div className="flex flex-col gap-[18px] print:hidden">
      <Panel>
        <MonoLabel>Start from a fanbase</MonoLabel>
        <ToolForm initial={fanbase} placeholder="A fanbase, e.g. Phoebe Bridgers" button="Draft the tour" examples={EXAMPLES} onSubmit={(v) => void run(v)} busy={state.loading} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-chip">
            Region
            <select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)} className={cx(FIELD, "cursor-pointer")}>
              {REGION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-chip">
            Stops
            <input type="number" min={2} max={12} value={stops} onChange={(e) => setStops(Math.max(2, Math.min(12, Number(e.target.value) || 2)))} aria-label="Stops" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-chip">
            <span className="flex items-center gap-2">
              Start date <YourDataBadge />
            </span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" className={FIELD} />
          </label>
        </div>
        <span className="text-chip text-mute">The cities and their order come from the Tour optimizer (Qloo heat, distances from coordinates). Dates are drafted from your start date; nothing else is filled in until you ask.</span>
      </Panel>
      {state.loading && <Banner tone="neutral">Routing {fanbase} through its strongest cities…</Banner>}
      {state.error && <ToolError message={state.error} onRetry={() => void run(fanbase)} />}
      {r?.status === "none" && <Banner tone="neutral">We couldn&apos;t find a fanbase called “{fanbase}”. Try one of the examples.</Banner>}
      {r?.status === "choose" && r.choices && <ChoicePicker question={r.question ?? "Which one?"} choices={r.choices} onPick={(id) => void run(fanbase, id)} />}
      {r?.status === "done" && r.route.infeasible && <Banner tone="warn">{r.route.infeasible}</Banner>}

      {workspace && workspace.saved.length > 0 && (
        <Panel>
          <MonoLabel>Saved tours · {workspace.name}</MonoLabel>
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Saved tours in the workspace">
            {workspace.saved.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
                <Link href={`/tour/planner?id=${t.id}`}>{t.name}</Link>
                <span className="tabular font-mono text-chip text-mute">{t.updatedAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {local.length > 0 && (
        <Panel>
          <MonoLabel>Kept in this browser</MonoLabel>
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Tours kept in this browser">
            {local.map((t) => (
              <li key={t.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
                <Link href={`/tour/planner?local=${t.key}`}>{t.name}</Link>
                <span className="flex items-center gap-2">
                  <span className="tabular font-mono text-chip text-mute">{t.savedAt.slice(0, 10)}</span>
                  <Button onClick={() => removeLocal(t.key)} aria-label={`Delete ${t.name} from this browser`}>
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/* ---------- The editor ---------- */

function Editor({
  it,
  change,
  undo,
  save,
  saving,
  dirty,
  saveLabel,
  upgradeNote,
  startOver,
}: {
  it: Itinerary;
  change: (next: Itinerary, record?: boolean) => void;
  undo: (() => void) | null;
  save: () => Promise<void>;
  saving: { busy: boolean; text: string | null };
  dirty: boolean;
  saveLabel: string;
  upgradeNote: string | null;
  startOver: () => void;
}) {
  const schedule = useMemo(() => computeSchedule(it), [it]);
  const [suggest, setSuggest] = useState<Record<string, SuggestState>>({});
  const [ai, setAi] = useState<AiState>({ busy: false });
  const [instruction, setInstruction] = useState("");
  const [adding, setAdding] = useState<{ text: string; busy: boolean; error?: string }>({ text: "", busy: false });

  const setStop = (id: string, patch: Partial<ItineraryStop>, record = true) => change({ ...it, stops: it.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, record);
  const moveStop = (i: number, d: -1 | 1) => {
    const stops = [...it.stops];
    [stops[i], stops[i + d]] = [stops[i + d], stops[i]];
    change({ ...it, stops });
  };

  const askQloo = async (stop: ItineraryStop, kind: SuggestKind) => {
    const k = `${stop.id}:${kind}`;
    setSuggest((s) => ({ ...s, [k]: { loading: true } }));
    try {
      const res = await fetch("/api/tools/tour/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fanbaseId: it.fanbase.id, fanbaseName: it.fanbase.name, category: it.fanbase.category, cityId: stop.city.id, kind }),
      });
      const json = (await res.json()) as SuggestResult & { error?: string };
      setSuggest((s) => ({ ...s, [k]: res.ok ? { loading: false, result: json } : { loading: false, error: json.error ?? "Something went wrong." } }));
    } catch {
      setSuggest((s) => ({ ...s, [k]: { loading: false, error: "Network error. Try again, or type your own." } }));
    }
  };

  const runAi = async (text = instruction) => {
    const t = text.trim();
    if (!t) return;
    setAi({ busy: true });
    try {
      const res = await fetch("/api/tour/planner/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itinerary: it, instruction: t }) });
      const json = (await res.json()) as { status?: "ok" | "fallback"; ops?: EditOp[]; rejected?: Rejected[]; summary?: string; reason?: string; error?: string };
      if (!res.ok || !json.status) return setAi({ busy: false, error: json.error ?? "Something went wrong." });
      if (json.status === "fallback") return setAi({ busy: false, fallback: json.reason });
      const ops = json.ops ?? [];
      if (ops.length) change(applyEdits(it, ops));
      setAi({ busy: false, summary: json.summary, labels: ops.map((o) => o.label), rejected: json.rejected ?? [], before: ops.length ? it : undefined });
      if (ops.length) setInstruction("");
    } catch {
      setAi({ busy: false, fallback: "The AI edit didn't run (network error), so nothing changed. You can edit every field directly." });
    }
  };

  const addStop = async () => {
    const q = adding.text.trim();
    if (!q) return;
    setAdding({ text: q, busy: true });
    const res = await fetch(`/api/tour/planner/city?q=${encodeURIComponent(q)}`).catch(() => null);
    const json = ((await res?.json().catch(() => null)) ?? {}) as { status?: string; city?: StopCity; options?: string[]; error?: string };
    if (json.status === "matched" && json.city) {
      if (it.stops.some((s) => s.city.id === json.city!.id)) return setAdding({ text: q, busy: false, error: `${json.city.name} is already on the tour.` });
      change({ ...it, stops: [...it.stops, emptyStop(json.city)] });
      return setAdding({ text: "", busy: false });
    }
    setAdding({ text: q, busy: false, error: json.status === "ambiguous" ? `Which one: ${json.options?.join(" or ")}? Add the region after a comma.` : (json.error ?? `No city called “${q}” in our city list.`) });
  };

  const points = it.stops.map((s, i) => ({ id: s.id, name: `${two(i + 1)} · ${s.city.name}`, lat: s.city.lat, lon: s.city.lon, value: s.heat ? String(pct(s.heat.score)) : "–", size: 16, tone: (s.heat ? "acc" : "line") as "acc" | "line", ring: i === 0 }));

  return (
    <>
      <div className="flex flex-col gap-[18px] print:hidden">
        <SampleBanner mock={it.mock} />
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <MonoLabel>
              Tour · {it.fanbase.name} · {categoryLabel(it.fanbase.category)}
            </MonoLabel>
            <span className="flex flex-wrap items-center gap-2">
              {undo && <Button onClick={undo}>Undo</Button>}
              <Button onClick={startOver}>New tour</Button>
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="flex flex-col gap-1 text-chip">
              Name
              <input value={it.name} maxLength={120} onChange={(e) => change({ ...it, name: e.target.value }, false)} aria-label="Tour name" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-chip">
              <span className="flex items-center gap-2">
                Start date <YourDataBadge />
              </span>
              <input type="date" value={it.startDate} onChange={(e) => change({ ...it, startDate: isIsoDate(e.target.value) ? e.target.value : "" })} aria-label="Start date" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-chip">
              <span className="flex items-center gap-2">
                Km per travel day <YourDataBadge />
              </span>
              <input
                type="number"
                min={ITINERARY_LIMITS.pace.min}
                max={ITINERARY_LIMITS.pace.max}
                step={50}
                value={it.kmPerTravelDay}
                onChange={(e) => change({ ...it, kmPerTravelDay: clampPace(Number(e.target.value)) }, false)}
                aria-label="Km per travel day"
                className={FIELD}
              />
            </label>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4" data-totals>
            {[
              ["Stops", String(it.stops.length)],
              ["Distance", km(schedule.totalKm)],
              ["Days", String(schedule.totalDays)],
              ["Show days", String(schedule.showDays)],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="font-mono text-label uppercase tracking-[0.06em] text-mute">{k}</dt>
                <dd className="tabular m-0 font-mono text-body">{v}</dd>
              </div>
            ))}
          </dl>
          {!it.startDate && !it.stops.some((s) => s.date) && <span className="text-chip text-mute">Set a start date to draft every date. Until then the days are counted, not dated.</span>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void save()} loading={saving.busy}>
              {saveLabel}
            </Button>
            <Button onClick={() => download(itineraryCsv(it, schedule), "text/csv;charset=utf-8", itineraryFileName(it, "csv"))}>Download CSV</Button>
            <Button onClick={() => download(itineraryIcs(it, { schedule }), "text/calendar;charset=utf-8", itineraryFileName(it, "ics"))} disabled={!schedule.days.some((d) => d.date)} title={schedule.days.some((d) => d.date) ? undefined : "Set a start date first"}>
              Calendar (.ics)
            </Button>
            <Button onClick={() => window.print()}>Print or PDF</Button>
            {dirty && !saving.busy && <span className="text-chip text-mute">Unsaved changes</span>}
            {saving.text && (
              <span className="text-chip text-mute" role="status">
                {saving.text}
              </span>
            )}
          </div>
          {upgradeNote && <span className="text-chip text-mute" data-upgrade-note>{upgradeNote}</span>}
        </Panel>

        <Panel>
          <MonoLabel>Tell the planner what to change</MonoLabel>
          <form
            className="flex flex-wrap items-stretch gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runAi();
            }}
          >
            <input
              value={instruction}
              maxLength={400}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. swap Denver for Boulder, start on 14 March, add Jane Doe as promoter in Nashville, jane@x.com"
              aria-label="Tell the planner what to change"
              className={cx(FIELD, "min-w-[240px] flex-1")}
            />
            <Button type="submit" variant="primary" loading={ai.busy} className="min-h-[40px]">
              Apply
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {AI_EXAMPLES.map((x) => (
              <Button key={x} onClick={() => setInstruction(x)}>
                {x}
              </Button>
            ))}
          </div>
          <span className="text-chip text-mute">The model only proposes edits; the planner checks each one. A date or number is used only if you typed it, and cities must be in our city list.</span>
          {ai.error && <ToolError message={ai.error} />}
          {ai.fallback && <Banner tone="warn">{ai.fallback}</Banner>}
          {ai.summary && (
            <div className="flex flex-col gap-1.5" role="status" data-ai-result>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-chip">{ai.labels?.length ? "Changed" : ai.summary}</span>
                {ai.before && (
                  <Button
                    onClick={() => {
                      change(ai.before!);
                      setAi({ busy: false });
                    }}
                  >
                    Undo these changes
                  </Button>
                )}
              </div>
              {!!ai.labels?.length && (
                <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-chip">
                  {ai.labels.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              )}
              {!!ai.rejected?.length && (
                <Banner tone="warn">
                  Not applied: {ai.rejected.map((r) => r.reason).join(" ")}
                </Banner>
              )}
            </div>
          )}
        </Panel>

        {schedule.warnings.map((w, i) => (
          <Banner key={i} tone="warn">
            {w.text}
          </Banner>
        ))}

        <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="flex min-w-0 flex-col gap-[18px]">
            {it.stops.length > 0 && <GeoMap points={points} route={it.stops.map((s) => s.city)} label={`Map of a ${it.stops.length}-stop tour for ${it.fanbase.name}`} />}
            <ol className="m-0 flex list-none flex-col gap-[18px] p-0" aria-label="Stops">
              {it.stops.map((s, i) => (
                <StopCard
                  key={s.id}
                  stop={s}
                  index={i}
                  count={it.stops.length}
                  prev={it.stops[i - 1]}
                  schedule={schedule}
                  setStop={(patch, record) => setStop(s.id, patch, record)}
                  move={(d) => moveStop(i, d)}
                  remove={() => change({ ...it, stops: it.stops.filter((x) => x.id !== s.id) })}
                  suggest={(kind) => suggest[`${s.id}:${kind}`]}
                  askQloo={(kind) => void askQloo(s, kind)}
                />
              ))}
            </ol>
            <Panel>
              <MonoLabel>Add a stop</MonoLabel>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addStop();
                }}
              >
                <input value={adding.text} onChange={(e) => setAdding({ text: e.target.value, busy: false })} placeholder="A city, e.g. Portland, Oregon" aria-label="Add a stop" className={cx(FIELD, "min-w-[200px] flex-1")} />
                <Button type="submit" loading={adding.busy} disabled={it.stops.length >= ITINERARY_LIMITS.stops}>
                  Add at the end
                </Button>
              </form>
              {adding.error && <span className="text-chip text-warn">{adding.error}</span>}
              <span className="text-chip text-mute">A stop you add has no Qloo heat score until a new route is optimized; its other fields work the same.</span>
            </Panel>
          </div>
          <Timeline it={it} schedule={schedule} />
        </div>
      </div>
      <PrintView it={it} schedule={schedule} />
    </>
  );
}

/* ---------- One stop ---------- */

function StopCard({
  stop: s,
  index: i,
  count,
  prev,
  schedule,
  setStop,
  move,
  remove,
  suggest,
  askQloo,
}: {
  stop: ItineraryStop;
  index: number;
  count: number;
  prev?: ItineraryStop;
  schedule: Schedule;
  setStop: (patch: Partial<ItineraryStop>, record?: boolean) => void;
  move: (d: -1 | 1) => void;
  remove: () => void;
  suggest: (kind: SuggestKind) => SuggestState | undefined;
  askQloo: (kind: SuggestKind) => void;
}) {
  const sch = schedule.stops[i];
  const [contact, setContact] = useState<Omit<Contact, "id">>({ role: "", name: "", email: "", phone: "" });
  return (
    <li data-stop={s.city.name}>
      <Panel>
        {prev && (
          <span className="font-mono text-label text-mute" data-leg>
            ↓ {prev.city.name} → {s.city.name} · {km(sch.legKm)}
            {sch.travelDays ? ` · ${plural(sch.travelDays, "travel day")} at your pace` : " · within a day's drive"}
          </span>
        )}
        <div className="grid grid-cols-[2.5em_minmax(0,1fr)_auto] items-start gap-3">
          <span className="tabular font-mono text-label text-acc-text">{two(i + 1)}</span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-[18px] font-semibold">
              {s.city.name}
              {s.city.admin1 && <span className="text-chip font-normal text-mute">{s.city.admin1}</span>}
              {s.role === "added" ? <OutlineChip>you added it</OutlineChip> : s.role !== "chosen" && <OutlineChip>{s.role === "included" ? "you included it" : s.role}</OutlineChip>}
            </span>
            {s.heat ? (
              <span className="flex flex-col gap-1 pt-1" data-evidence>
                <span className="flex items-center gap-2">
                  <SourceBadge />
                  <ScoreBar value={pct(s.heat.score)} label={`${pct(s.heat.score)} / 100`} className="max-w-[220px] flex-1" />
                </span>
                <span className="text-chip text-mute">
                  Qloo heat over {s.heat.cells} cells, against {s.heat.against}
                </span>
                {s.heat.call && <span className="font-mono text-label text-mute [overflow-wrap:anywhere]">{s.heat.call}</span>}
              </span>
            ) : (
              <span className="text-chip text-mute">No Qloo heat score for this stop.</span>
            )}
          </span>
          <span className="flex gap-1">
            <Button aria-label={`Move ${s.city.name} up`} disabled={i === 0} onClick={() => move(-1)}>
              ↑
            </Button>
            <Button aria-label={`Move ${s.city.name} down`} disabled={i === count - 1} onClick={() => move(1)}>
              ↓
            </Button>
            <Button aria-label={`Remove ${s.city.name}`} onClick={remove}>
              Remove
            </Button>
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-chip">
            First show
            <input type="date" value={s.date} onChange={(e) => setStop({ date: isIsoDate(e.target.value) ? e.target.value : "" })} aria-label={`Date in ${s.city.name}`} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-chip">
            Shows
            <input type="number" min={1} max={ITINERARY_LIMITS.shows} value={s.shows} onChange={(e) => setStop({ shows: Math.max(1, Math.min(ITINERARY_LIMITS.shows, Math.round(Number(e.target.value)) || 1)) })} aria-label={`Shows in ${s.city.name}`} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-chip">
            Rest days after
            <input type="number" min={0} max={ITINERARY_LIMITS.restAfter} value={s.restAfter} onChange={(e) => setStop({ restAfter: Math.max(0, Math.min(ITINERARY_LIMITS.restAfter, Math.round(Number(e.target.value)) || 0)) })} aria-label={`Rest days after ${s.city.name}`} className={FIELD} />
          </label>
        </div>
        <span className="flex flex-wrap items-center gap-2 text-chip" data-date-source>
          {s.date ? (
            <>
              {s.shows > 1 ? `${s.date} to ${sch.last}` : s.date} <YourDataBadge />
              <Button onClick={() => setStop({ date: "" })}>Use the draft date</Button>
            </>
          ) : sch.first ? (
            <>
              <span className="tabular font-mono">{s.shows > 1 ? `${sch.first} to ${sch.last}` : sch.first}</span>
              <ConfirmPill>{DRAFT_LABEL}</ConfirmPill>
            </>
          ) : (
            <span className="text-mute">No date yet: set a start date or a date here.</span>
          )}
        </span>

        {FIELDS.map((f) => (
          <PickField key={f.key} label={f.label} button={f.button} city={s.city.name} value={s[f.key]} onChange={(v, record) => setStop({ [f.key]: v }, record)} state={suggest(f.kind)} onSuggest={() => askQloo(f.kind)} />
        ))}

        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-chip">
            People and contacts {s.contacts.length > 0 && <YourDataBadge />}
          </span>
          {s.contacts.length > 0 && (
            <ul className="m-0 flex list-none flex-col p-0" aria-label={`Contacts in ${s.city.name}`}>
              {s.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 text-chip">
                  <span className="[overflow-wrap:anywhere]">
                    {c.role && <span className="font-mono text-label uppercase text-mute">{c.role} · </span>}
                    {c.name}
                    {c.email && ` · ${c.email}`}
                    {c.phone && ` · ${c.phone}`}
                  </span>
                  <Button aria-label={`Remove ${c.name}`} onClick={() => setStop({ contacts: s.contacts.filter((x) => x.id !== c.id) })}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            onSubmit={(e) => {
              e.preventDefault();
              if (!contact.name.trim() || s.contacts.length >= ITINERARY_LIMITS.contacts) return;
              setStop({ contacts: [...s.contacts, { id: newId(), role: contact.role.trim(), name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.trim() }] });
              setContact({ role: "", name: "", email: "", phone: "" });
            }}
          >
            <input value={contact.role} maxLength={60} onChange={(e) => setContact({ ...contact, role: e.target.value })} placeholder="Role, e.g. promoter" aria-label={`Contact role in ${s.city.name}`} className={cx(FIELD, "min-w-0 py-1 text-chip")} />
            <input value={contact.name} maxLength={120} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder="Name" aria-label={`Contact name in ${s.city.name}`} className={cx(FIELD, "min-w-0 py-1 text-chip")} />
            <input type="email" value={contact.email} maxLength={160} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="Email" aria-label={`Contact email in ${s.city.name}`} className={cx(FIELD, "min-w-0 py-1 text-chip")} />
            <input value={contact.phone} maxLength={60} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="Phone" aria-label={`Contact phone in ${s.city.name}`} className={cx(FIELD, "min-w-0 py-1 text-chip")} />
            <Button type="submit" disabled={!contact.name.trim()} className="justify-self-start sm:col-span-2">
              Add
            </Button>
          </form>
        </div>
        <label className="flex flex-col gap-1 text-chip">
          <span className="flex items-center gap-2">Notes {s.notes && <YourDataBadge />}</span>
          <textarea value={s.notes} maxLength={ITINERARY_LIMITS.notes} rows={2} onChange={(e) => setStop({ notes: e.target.value }, false)} aria-label={`Notes for ${s.city.name}`} className={FIELD} />
        </label>
      </Panel>
    </li>
  );
}

/** A venue, support act or sponsor: typed by the user, or picked from Qloo suggestions they asked for. */
function PickField({
  label,
  button,
  city,
  value,
  onChange,
  state,
  onSuggest,
}: {
  label: string;
  button: string;
  city: string;
  value: Picked | null;
  onChange: (v: Picked | null, record?: boolean) => void;
  state?: SuggestState;
  onSuggest: () => void;
}) {
  const use = (p: Suggestion) => onChange({ name: p.name, source: "qloo", qlooId: p.qlooId, score: p.score, evidence: p.evidence });
  const r = state?.result;
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="flex flex-col gap-1 text-chip">
          <span className="flex flex-wrap items-center gap-2">
            {label}
            {value?.source === "user" && <YourDataBadge />}
            {value?.source === "qloo" && (
              <>
                <SourceBadge />
                {value.score !== undefined && <span className="tabular font-mono">{pct(value.score)} / 100</span>}
              </>
            )}
          </span>
          <input
            value={value?.name ?? ""}
            maxLength={ITINERARY_LIMITS.text}
            // Typing over a Qloo pick makes it the user's own value.
            onChange={(e) => onChange(e.target.value.trim() ? { name: e.target.value, source: "user" } : null, false)}
            placeholder={`Type your own, or ask Qloo`}
            aria-label={`${label} in ${city}`}
            className={FIELD}
          />
        </label>
        <Button onClick={onSuggest} loading={state?.loading} className="min-h-[40px]">
          {button}
        </Button>
      </div>
      {value?.source === "qloo" && value.evidence && <span className="text-chip text-mute">{value.evidence}</span>}
      {state?.error && <span className="text-chip text-warn">{state.error}</span>}
      {r && (
        <div className="flex flex-col gap-1.5 rounded-md border-th border-line px-3 py-2" data-suggestions={r.kind}>
          <SampleBanner mock={r.mock} />
          {r.fallback && <span className="text-chip text-mute">{r.reason}</span>}
          {r.picks.length === 0 ? (
            <span className="text-chip text-mute">Qloo had nothing to suggest here. Type your own.</span>
          ) : (
            r.picks.map((p) => (
              <div key={p.qlooId} className="grid grid-cols-[minmax(0,1fr)_minmax(90px,140px)_auto] items-center gap-3">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium [overflow-wrap:anywhere]">{p.name}</span>
                  <span className="text-chip text-mute">
                    {p.evidence} · {p.confidence} confidence
                  </span>
                </span>
                <ScoreBar value={pct(p.score)} label={`${pct(p.score)}`} />
                <Button variant="pick" onClick={() => use(p)} aria-label={`Use ${p.name}`}>
                  Use
                </Button>
              </div>
            ))
          )}
          <span className="flex flex-wrap items-center gap-2 text-chip text-mute">
            <SourceBadge /> Ranked by Takeover&apos;s engine from Qloo. Availability, fees and capacity are to confirm with the promoter.
          </span>
          <CallsUsed calls={r.calls} />
        </div>
      )}
    </div>
  );
}

/* ---------- Day by day ---------- */

const DAY_LABEL: Record<ScheduleDay["kind"], string> = { show: "Show", travel: "Travel", rest: "Rest", off: "Open" };

function dayText(it: Itinerary, d: ScheduleDay): string {
  const s = it.stops[d.stopIndex];
  if (d.kind === "travel") return `${d.from} → ${d.to}`;
  if (d.kind === "rest") return `Rest in ${s.city.name}`;
  if (d.kind === "off") return `Open day before ${s.city.name}`;
  return [s.city.name, s.shows > 1 ? `show ${d.show}` : "", s.venue?.name].filter(Boolean).join(" · ");
}

function Timeline({ it, schedule }: { it: Itinerary; schedule: Schedule }) {
  return (
    <Panel className="lg:sticky lg:top-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <MonoLabel>Day by day · {plural(schedule.days.length, "day")}</MonoLabel>
      </div>
      <span className="flex flex-wrap items-center gap-2 text-chip text-mute">
        <ConfirmPill>{DRAFT_LABEL}</ConfirmPill> on every date not marked <YourDataBadge />
      </span>
      <ol className="m-0 flex max-h-[70vh] list-none flex-col overflow-auto p-0" aria-label="Days">
        {schedule.days.map((d, i) => (
          <li key={i} className={cx("grid grid-cols-[6.5em_4.5em_minmax(0,1fr)] items-baseline gap-2 border-b border-line py-1.5 text-chip", d.kind !== "show" && "text-mute")} data-day={d.kind}>
            <span className="tabular font-mono">{d.date ?? (d.dayNumber ? `Day ${d.dayNumber}` : "—")}</span>
            <span className="font-mono text-label uppercase tracking-[0.06em]">{DAY_LABEL[d.kind]}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 [overflow-wrap:anywhere]">
              {dayText(it, d)}
              {d.date && d.source === "user" && <YourDataBadge />}
              {d.date && d.source === "draft" && <span className="font-mono text-label uppercase text-warn">Draft</span>}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/* ---------- Print ---------- */

/** Only this prints (the rest of the page is print:hidden): the itinerary on paper. */
function PrintView({ it, schedule }: { it: Itinerary; schedule: Schedule }) {
  const src = (p: Picked | null) => (!p ? "" : p.source === "qloo" ? ` (Qloo signal${p.score !== undefined ? ` ${pct(p.score)}/100` : ""})` : " (Your data)");
  return (
    <article aria-hidden className="hidden flex-col gap-4 bg-paper text-paper-ink print:flex">
      <div className="flex justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">
        <span>Tour planner · {it.fanbase.name}</span>
        <span>{it.mock ? "Sample data, not Qloo results" : "Heat scores and picks marked Qloo signal are from Qloo"}</span>
      </div>
      <h1 className="m-0 text-[24px] font-semibold">{it.name}</h1>
      <p className="m-0 text-[12px]">
        {plural(it.stops.length, "stop")} · {km(schedule.totalKm)} · {plural(schedule.totalDays, "day")}. Dates marked draft are computed from your start date and pace: {DRAFT_LABEL.toLowerCase()}. Distances are straight-line between city centres.
      </p>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-paper-line text-left">
            <th className="py-1 pr-2">Date</th>
            <th className="py-1 pr-2">Day</th>
            <th className="py-1 pr-2">Where</th>
            <th className="py-1">Details</th>
          </tr>
        </thead>
        <tbody>
          {schedule.days.map((d, i) => {
            const s = it.stops[d.stopIndex];
            const first = d.kind === "show" && d.show === 1;
            return (
              <tr key={i} className="border-b border-paper-line align-top">
                <td className="py-1 pr-2 font-mono whitespace-nowrap">
                  {d.date ?? (d.dayNumber ? `Day ${d.dayNumber}` : "")}
                  {d.date && <span className="text-paper-mute">{d.source === "user" ? " · yours" : " · draft"}</span>}
                </td>
                <td className="py-1 pr-2">{DAY_LABEL[d.kind]}</td>
                <td className="py-1 pr-2">{d.kind === "travel" ? `${d.from} → ${d.to}` : s.city.name}</td>
                <td className="py-1">
                  {first && (
                    <>
                      {s.venue && <div>Venue: {s.venue.name + src(s.venue)}</div>}
                      {s.support && <div>Support: {s.support.name + src(s.support)}</div>}
                      {s.sponsor && <div>Sponsor: {s.sponsor.name + src(s.sponsor)}</div>}
                      {s.contacts.map((c) => (
                        <div key={c.id}>{[c.role, c.name, c.email, c.phone].filter(Boolean).join(" · ")}</div>
                      ))}
                      {s.notes && <div className="text-paper-mute">{s.notes}</div>}
                      {s.heat && <div className="text-paper-mute">Qloo heat {pct(s.heat.score)}/100</div>}
                      {d.stopIndex > 0 && <div className="text-paper-mute">Leg {km(schedule.stops[d.stopIndex].legKm)}</div>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="m-0 text-[10px] text-paper-mute">Venue availability, fees and capacity are to confirm with the promoter.</p>
    </article>
  );
}
