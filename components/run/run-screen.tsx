"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Overrides, StepId } from "@/lib/agent/types";
import { summarise } from "@/lib/plan-summary";
import { savePlanLocally } from "@/lib/saved-plans";
import { STEPS } from "@/lib/agent/types";

import { AppHeader, Banner, Button, InputBar, MonoLabel, OutlineChip, Page, Sk, StepCard, cx, type StepData } from "../ui";
import { AudiencePanel } from "../audience";
import { categoryLabel } from "./format";
import { BriefSection, CitySection, CrossoverSection, OutreachSection, RoomSection, type LlmOnly } from "./sections";
import { ApiBusy, EntityPicker, NoMatch } from "./states";
import { usePlanStream, type RunView } from "./use-plan-stream";

/** The fanbase and the chosen partner, for the audience profile. */
export function audiencePeople(view: Pick<RunView, "fanbase" | "partners">): Array<{ id: string; name: string }> {
  const partner = view.partners?.picks.find((p) => p.pick.entity.id === view.partners?.chosenId)?.pick.entity;
  return [view.fanbase, partner].flatMap((e) => (e ? [{ id: e.id, name: e.name }] : []));
}

function stepData(view: RunView, id: StepId, i: number, title: string): StepData & { showBranch: boolean } {
  const s = view.steps[id];
  const first = s.calls[0];
  const more = s.calls.length > 1 ? ` · ${s.calls.length} calls` : "";
  return {
    n: String(i + 1).padStart(2, "0"),
    title,
    status: s.status,
    seconds: s.seconds,
    liveText: s.liveText,
    branch: s.branch,
    fallbackText: s.fallbackText,
    errorText: s.errorText,
    decision: s.decision,
    endpoint: first ? `GET ${first.endpoint}${first.cached ? " · cached" : ""}${more}` : undefined,
    params: first ? Object.entries(first.params) : undefined,
    showBranch: Boolean(s.branch),
  };
}

export function RunScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const query = (params.get("q") ?? "").trim();
  // Links from a roster name the act (and, for a pairing, the partner) so the run starts on them.
  const entityParam = params.get("entity") ?? "";
  const partnerParam = params.get("partner") ?? "";
  const partnerCategoryParam = params.get("pc") ?? "";
  const { view, start, savedTo } = usePlanStream();
  const overrides = useRef<Overrides>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showLog, setShowLog] = useState(false);
  // Keyed by query, so a new search starts with the comparison reset.
  const [llmState, setLlmState] = useState<LlmOnly & { on: boolean; q: string }>({ state: "idle", on: false, q: query });
  const llm = llmState.q === query ? llmState : { state: "idle" as const, on: false, q: query };
  const setLlm = (next: LlmOnly & { on: boolean }) => setLlmState({ ...next, q: query });
  const [draft, setDraft] = useState(query);

  const run = useCallback(
    (o: Overrides = {}, from: StepId | null = null) => {
      overrides.current = o;
      void start(query, Object.keys(o).length ? o : undefined, from);
    },
    [query, start],
  );

  useEffect(() => {
    if (!query) return;
    const linked: Overrides = {};
    if (entityParam) linked.entityId = entityParam;
    if (entityParam && partnerParam) {
      linked.partnerId = partnerParam;
      if (partnerCategoryParam) linked.partnerCategory = partnerCategoryParam as Overrides["partnerCategory"];
    }
    run(linked);
  }, [query, run, entityParam, partnerParam, partnerCategoryParam]);

  // Finished plans go to My plans (this browser only), unless the run saved them to a workspace.
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    const plan = view.plan;
    if (!plan || plan.status !== "complete" || savedTo) return;
    const summary = summarise(plan, plan.cachedRun?.recordedAt ?? new Date().toISOString());
    if (!summary) return;
    savePlanLocally({ ...summary, savedAt: new Date().toISOString(), mock: plan.mock });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the save that just happened
    setSaved(plan.runId);
  }, [view.plan, savedTo]);

  const goTo = (q: string) => router.push(`/run?q=${encodeURIComponent(q)}`);

  const toggleLlm = async (on: boolean) => {
    setLlm({ ...llm, on });
    if (!on || llm.state === "ready" || llm.state === "loading") return;
    setLlm({ state: "loading", on: true });
    try {
      const res = await fetch("/api/llm-only", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: view.fanbase?.name ?? query }),
      });
      const body = (await res.json()) as { text?: string; error?: string };
      setLlm(res.ok ? { state: "ready", text: body.text, on: true } : { state: "error", message: body.error, on: true });
    } catch {
      setLlm({ state: "error", message: "The comparison could not be loaded.", on: true });
    }
  };

  if (!query) {
    return (
      <Page>
        <AppHeader />
        <InputBar value={draft} onChange={setDraft} onSubmit={() => draft.trim() && goTo(draft.trim())} placeholder="Plan a takeover for…" />
      </Page>
    );
  }

  const fanbase = view.fanbase;
  const partnerId = view.partners?.chosenId ?? undefined;
  const usePartner = (id: string) => fanbase && run({ entityId: fanbase.id, partnerId: id }, "partners");
  const useCity = (id: string) => fanbase && run({ entityId: fanbase.id, partnerId, cityId: id }, "city");
  const pick = (entityId: string) => run({ entityId });
  const retry = () => run(overrides.current);

  const steps = STEPS.map((s, i) => stepData(view, s.id, i, s.title));
  const complete = steps.filter((s) => s.status === "done" || s.status === "fallback").length;
  const current = steps.find((s) => s.status === "running" || s.status === "error");
  const finished = view.phase === "done";
  const needs = view.needsInput;
  const status =
    view.error ? "Stopped" : needs && finished ? "Waiting for you" : finished ? `Complete · ${complete} / 7` : `Step ${Math.min(complete + 1, 7)} of 7`;
  const currentTitle = view.error
    ? "Stopped"
    : finished
      ? needs
        ? "Waiting for your pick"
        : "Run complete"
      : (current?.title ?? steps[0].title);
  const shareUrl =
    view.plan && typeof window !== "undefined" ? `${window.location.origin}/plan/${view.plan.runId}` : undefined;

  const log = (
    <section className="flex flex-col gap-2" aria-label="Agent log">
      <div className="flex justify-between pb-1 font-mono text-label uppercase tracking-[0.08em] text-mute">
        <span>Agent log</span>
        <span className="tabular">{complete} / 7</span>
      </div>
      <div aria-live="polite" aria-relevant="text" className="sr-only">
        {current?.liveText ?? (finished ? currentTitle : "")}
      </div>
      {steps.map((s, i) => (
        <StepCard
          key={s.n}
          step={s}
          showBranch={s.showBranch}
          open={!!open[s.n]}
          onToggle={() => setOpen((o) => ({ ...o, [s.n]: !o[s.n] }))}
          onRetry={i > 0 ? retry : undefined}
        />
      ))}
      {view.plan?.notes.length ? (
        <div className="flex flex-col gap-1 pt-1 text-chip text-mute">
          <MonoLabel>Labelled notes</MonoLabel>
          {view.plan.notes.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      ) : null}
    </section>
  );

  const pausedForInput = needs && finished && !fanbase;
  const stoppedEarly = finished && view.plan?.status === "incomplete";

  return (
    <Page max="max-w-[1280px]">
      <AppHeader
        context={`Run · ${query}`}
        right={
          <>
            <div className="tabular font-mono text-[11px] uppercase tracking-[0.06em] text-mute">{status}</div>
            <Button onClick={() => run()} loading={view.phase === "running"}>
              Replay
            </Button>
          </>
        }
      />

      {/* Mobile: log collapses into a progress bar */}
      <div className="flex flex-col gap-2.5 rounded-md bg-surf p-4 border-card border-ink shadow-card md:hidden print:hidden">
        <div className="flex items-baseline gap-2">
          <div className="tabular font-mono text-label uppercase tracking-[0.08em] text-acc-text">{complete} / 7</div>
          <div className="min-w-0 flex-1 truncate text-body font-medium">{currentTitle}</div>
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            aria-expanded={showLog}
            className="cursor-pointer border-0 bg-transparent py-1 font-mono text-label uppercase tracking-[0.06em] text-mute"
          >
            {showLog ? "Hide log" : "Show log"}
          </button>
        </div>
        <div className="h-2 overflow-hidden rounded-pill bg-track">
          <div className="h-full rounded-pill bg-acc-line transition-[width] duration-[400ms]" style={{ width: `${(complete / 7) * 100}%` }} />
        </div>
      </div>

      <div className="grid items-start gap-[22px] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] print:block">
        <div className={cx(showLog ? "block" : "hidden", "md:block print:hidden")}>{log}</div>

        <section className="flex min-w-0 flex-col gap-[18px]" aria-label="Results">
          <div className="flex flex-col gap-2 print:hidden">
            <MonoLabel>Results</MonoLabel>
            <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92] [text-wrap:balance]">
              {fanbase?.name ?? query} takeover
            </h1>
            <div className="flex min-h-[22px] flex-wrap items-center gap-2">
              {fanbase && <OutlineChip>{categoryLabel(fanbase.category)}</OutlineChip>}
              {view.format ? <OutlineChip>Format · {view.format.label.toLowerCase()}</OutlineChip> : !finished && <Sk.chip />}
              {view.plan?.planner === "scripted" && <OutlineChip>Planner · scripted (no model key)</OutlineChip>}
              {finished && view.plan?.status === "complete" && (
                <Link
                  href={`/plan/${view.plan.runId}#vote`}
                  className="rounded-pill border-th border-line px-2.5 py-0.5 text-chip text-mute no-underline hover:text-ink"
                >
                  Ask your team to vote
                </Link>
              )}
              {savedTo && finished && view.plan?.status === "complete" && (
                <Link href="/workspace" className="rounded-pill border-th border-line px-2.5 py-0.5 text-chip text-mute no-underline hover:text-ink">
                  Saved to {savedTo}
                </Link>
              )}
              {!savedTo && saved && saved === view.plan?.runId && (
                <Link href="/plans" className="rounded-pill border-th border-line px-2.5 py-0.5 text-chip text-mute no-underline hover:text-ink">
                  Saved to My plans
                </Link>
              )}
              {view.plan?.cachedRun && (
                <OutlineChip>
                  Cached run · recorded{" "}
                  {new Date(view.plan.cachedRun.recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </OutlineChip>
              )}
            </div>
          </div>

          {view.error?.kind === "busy" && <ApiBusy message={view.error.message} onRetry={retry} onExample={goTo} />}
          {view.error && view.error.kind !== "busy" && (
            <Banner tone="err" action={<Button variant="primary" onClick={retry}>Retry</Button>}>
              {view.error.message}
            </Banner>
          )}

          {pausedForInput && needs.kind === "ambiguous" && (
            <EntityPicker needs={needs} onPick={pick} busy={view.phase === "running"} />
          )}
          {pausedForInput && needs.kind !== "ambiguous" && (
            <NoMatch query={query} needs={needs} onPick={pick} onExample={goTo} />
          )}

          {!pausedForInput && !(view.error?.kind === "busy") && (
            <>
              {stoppedEarly && (
                <div className="print:hidden">
                  <Banner tone="warn">This plan is partial: some steps could not finish. Each gap is labelled in the log.</Banner>
                </div>
              )}
              {view.replanFrom === "city" && (
                <div className="print:hidden">
                  <Banner tone="info">Replanning room, brief and outreach…</Banner>
                </div>
              )}
              <CrossoverSection view={view} llm={llm} onToggle={toggleLlm} onUsePartner={usePartner} />
              {finished && fanbase && view.plan?.status === "complete" && (
                <div className="print:hidden">
                  <AudiencePanel people={audiencePeople(view)} />
                </div>
              )}
              <CitySection view={view} onUseCity={useCity} />
              <RoomSection view={view} />
              <BriefSection view={view} shareUrl={shareUrl} />
              <OutreachSection view={view} />
            </>
          )}
        </section>
      </div>
    </Page>
  );
}
