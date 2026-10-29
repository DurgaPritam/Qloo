"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { PlanSummary } from "@/lib/plan-summary";
import type { DailyPuzzle } from "@/lib/server/daily";
import { TOOLS, overlapHref } from "@/lib/site";

import { GAME_KEY, finishDay, read, write, type Result, type Saved } from "./daily-game";
import { PlanGrid } from "./showcase";
import { OverlapForm, PAIRS } from "./tools/fan-overlap";
import { Chip, MonoLabel, Panel, Segmented, SourceBadge, cx } from "./ui";

/** Round 1 of today's Daily, playable here. Progress is shared with /daily, which picks up at round 2. */
export function DailyTeaser({ puzzle }: { puzzle: DailyPuzzle }) {
  const [result, setResult] = useState<Result | null>(null);
  const [played, setPlayed] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const round = puzzle.rounds[0];

  useEffect(() => {
    const s = read<Saved>(GAME_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s?.date === puzzle.date && s.results.length) setPlayed(s);
  }, [puzzle.date]);

  const guess = async (option: string) => {
    if (busy || result) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/daily", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: puzzle.date, round: 0, option }),
    }).catch(() => null);
    setBusy(false);
    const body = res ? ((await res.json()) as Omit<Result, "option"> & { query?: string; error?: string }) : null;
    if (!res?.ok || !body) return setError(body?.error ?? "That guess could not be checked. Try again.");
    const r = { option, correct: body.correct, answer: body.answer, reveal: body.reveal };
    const results = [r];
    write(GAME_KEY, { date: puzzle.date, results, query: body.query });
    if (puzzle.rounds.length === 1) finishDay(puzzle.date, results);
    setResult(r);
  };

  const rest = puzzle.rounds.length - 1;
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel className="text-acc-text">Takeover Daily · #{puzzle.number}</MonoLabel>
        {result && <SourceBadge>Qloo answer</SourceBadge>}
      </div>
      {played ? (
        <>
          <h2 className="t-display m-0 text-[clamp(24px,3.5vw,32px)] leading-[0.95]">
            {played.results.map((r) => (r.correct ? "🟩" : "🟥")).join("")} {played.results.filter((r) => r.correct).length}/{played.results.length}
          </h2>
          <p className="m-0 text-body text-mute">
            {played.results.length >= puzzle.rounds.length ? `Done for today. A new fanbase at midnight UTC.` : `You're mid-game on ${puzzle.fanbase}.`}
          </p>
          <Link href="/daily" className="text-chip font-medium">
            {played.results.length >= puzzle.rounds.length ? "See your result and streak →" : "Keep playing →"}
          </Link>
        </>
      ) : (
        <>
          <h2 className="m-0 text-[18px] font-semibold leading-[1.25] [text-wrap:pretty]">{round.question}</h2>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {round.options.map((o) => {
              const isAnswer = result?.answer === o.id;
              const isPick = result?.option === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={Boolean(result) || busy}
                  onClick={() => guess(o.id)}
                  className={cx(
                    "flex cursor-pointer flex-col items-start rounded-md border-th bg-bg px-3 py-2 text-left font-body text-ink disabled:cursor-default",
                    !result && "border-line hover:bg-acc-soft",
                    result && isAnswer && "border-acc-line bg-acc-soft",
                    result && isPick && !isAnswer && "border-err",
                    result && !isAnswer && !isPick && "border-line opacity-70",
                  )}
                >
                  <span className="text-body font-medium [overflow-wrap:anywhere]">
                    {o.label}
                    {result && isAnswer && " ✓"}
                    {result && isPick && !isAnswer && " ✗"}
                  </span>
                  <span className="text-chip text-mute">{result ? (result.reveal[o.id] ?? o.meta) : o.meta}</span>
                </button>
              );
            })}
          </div>
          {error && <p className="m-0 text-chip text-err">{error}</p>}
          {result ? (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className={cx("m-0 text-body font-medium", result.correct ? "text-acc-text" : "text-err")}>
                {result.correct ? "Right: that's Qloo's pick." : "Not quite. The highlighted one is Qloo's pick."}
              </p>
              {rest > 0 && (
                <Link href="/daily" className="text-chip font-medium">
                  Play {rest === 1 ? "round 2" : `rounds 2 and ${rest + 1}`} →
                </Link>
              )}
            </div>
          ) : (
            <p className="m-0 text-chip text-mute">Round 1 of {puzzle.rounds.length}. A new fanbase every day; keep a streak.</p>
          )}
        </>
      )}
    </Panel>
  );
}

/** The two quick games side by side, then every other tool as one row of chips. */
export function PlayRow({ daily }: { daily: DailyPuzzle | null }) {
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const go = (href: string) => startNavigation(() => router.push(href));
  const more = TOOLS.filter((t) => t.href !== "/overlap");

  return (
    <section className="reveal flex flex-col gap-5 border-t border-line pt-8">
      <h2 className="t-display m-0 text-[clamp(30px,4vw,48px)] leading-[0.92]">Play with Qloo</h2>
      <div className={cx("grid items-start gap-[18px]", daily && "lg:grid-cols-2")}>
        {daily && <DailyTeaser puzzle={daily} />}
        <Panel>
          <MonoLabel className="text-acc-text">Fan overlap</MonoLabel>
          <h2 className="t-display m-0 text-[clamp(24px,3.5vw,32px)] leading-[0.95]">Would these fans mix?</h2>
          <p className="m-0 text-[15px] text-mute">Any two names: how much their fans overlap, and where.</p>
          <OverlapForm onSubmit={(a, b) => go(overlapHref(a, b))} />
          <div className="flex flex-wrap items-center gap-2">
            {PAIRS.slice(0, 3).map(([a, b]) => (
              <Chip key={a + b} label={`${a} × ${b}`} onClick={() => go(overlapHref(a, b))} />
            ))}
          </div>
        </Panel>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] text-mute">More tools:</span>
        {more.map((t) => (
          <Chip key={t.href} label={t.label} onClick={() => go(t.example)} />
        ))}
        <Link href="/tools" className="text-chip">
          All tools →
        </Link>
      </div>
    </section>
  );
}

/** Featured plans and visitors' recent ones in one grid, switched by a tab. */
export function PlanTabs({ featured, recent, total }: { featured: readonly PlanSummary[]; recent: readonly PlanSummary[]; total: number }) {
  const [tab, setTab] = useState<"featured" | "recent">("featured");
  const showing = tab === "recent" && recent.length ? recent : featured;
  return (
    <section className="reveal flex flex-col gap-5 border-t border-line pt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-display m-0 text-[clamp(30px,4vw,48px)] leading-[0.92]">Planned with Qloo</h2>
        <div className="flex flex-wrap items-center gap-3">
          {recent.length > 0 && (
            <Segmented
              label="Which plans"
              value={tab}
              onChange={setTab}
              options={[
                { value: "featured", label: "Featured" },
                { value: "recent", label: "Just planned" },
              ]}
            />
          )}
          <Link href="/explore" className="text-chip">
            See all {total} →
          </Link>
        </div>
      </div>
      <PlanGrid plans={showing} shared={tab === "recent" && recent.length > 0} />
    </section>
  );
}
