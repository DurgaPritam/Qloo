"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { DailyPuzzle } from "@/lib/server/daily";

import { planHref } from "./showcase";
import { Banner, Button, MonoLabel, OutlineChip, Panel, Sk, SourceBadge, cx, useCopy } from "./ui";

interface Result {
  option: string;
  correct: boolean;
  answer: string;
  reveal: Record<string, string>;
}

interface Saved {
  date: string;
  results: Result[];
  query?: string;
}

interface Stats {
  played: number;
  perfect: number;
  streak: number;
  best: number;
  lastDate: string | null;
}

const GAME_KEY = "takeover:daily:v1";
const STATS_KEY = "takeover:daily:stats:v1";

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: progress lasts for this page only.
  }
}

const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Updates the streak when the last round of a day is played. */
function finishDay(date: string, results: Result[]): Stats {
  const s = read<Stats>(STATS_KEY) ?? { played: 0, perfect: 0, streak: 0, best: 0, lastDate: null };
  if (s.lastDate === date) return s;
  const streak = s.lastDate === dayBefore(date) ? s.streak + 1 : 1;
  const next = {
    played: s.played + 1,
    perfect: s.perfect + (results.every((r) => r.correct) ? 1 : 0),
    streak,
    best: Math.max(s.best, streak),
    lastDate: date,
  };
  write(STATS_KEY, next);
  return next;
}

export function DailyGame() {
  const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => {
    fetch("/api/daily")
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as DailyPuzzle & { error?: string } }))
      .then(({ ok, body }) => {
        if (!ok) return setError(body.error ?? "Today's puzzle could not be loaded.");
        setPuzzle(body);
        const s = read<Saved>(GAME_KEY);
        setSaved(s?.date === body.date ? s : { date: body.date, results: [] });
        setStats(read<Stats>(STATS_KEY));
      })
      .catch(() => setError("Today's puzzle could not be loaded. Check your connection."));
  }, []);

  if (error) return <Banner tone="err">{error}</Banner>;
  if (!puzzle || !saved) return <Sk.block />;

  const round = saved.results.length;
  const done = round >= puzzle.rounds.length;

  const guess = async (option: string) => {
    if (busy || done) return;
    setBusy(true);
    const res = await fetch("/api/daily", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: puzzle.date, round, option }),
    }).catch(() => null);
    setBusy(false);
    const body = res ? ((await res.json()) as Omit<Result, "option"> & { query?: string; error?: string }) : null;
    if (!res?.ok || !body) return setError(body?.error ?? "That guess could not be checked. Try again.");
    const results = [...saved.results, { option, correct: body.correct, answer: body.answer, reveal: body.reveal }];
    const next = { date: puzzle.date, results, query: body.query ?? saved.query };
    setSaved(next);
    write(GAME_KEY, next);
    if (results.length === puzzle.rounds.length) setStats(finishDay(puzzle.date, results));
  };

  const grid = saved.results.map((r) => (r.correct ? "🟩" : "🟥")).join("");
  const score = saved.results.filter((r) => r.correct).length;
  const shareText = `Takeover Daily #${puzzle.number} ${grid} ${score}/${puzzle.rounds.length}\nCan you guess what Qloo knows about ${puzzle.fanbase} fans?`;

  return (
    <>
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>Takeover Daily · #{puzzle.number}</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">Guess what Qloo knows about {puzzle.fanbase} fans</h1>
        <p className="m-0 max-w-[62ch] text-body text-mute [text-wrap:pretty]">
          Three rounds, a new fanbase every day. Each answer is Qloo taste data from a real takeover plan; after each guess you
          see the numbers.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {puzzle.rounds.map((_, i) => (
            <OutlineChip key={i}>
              Round {i + 1} {saved.results[i] ? (saved.results[i].correct ? "🟩" : "🟥") : i === round ? "·" : ""}
            </OutlineChip>
          ))}
          {stats && <OutlineChip>Streak {stats.streak} · best {stats.best}</OutlineChip>}
        </div>
      </section>

      {puzzle.rounds.map((r, i) => {
        const result = saved.results[i];
        if (i > round) return null;
        return (
          <Panel key={i}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MonoLabel className="text-acc-text">Round {i + 1}</MonoLabel>
              {result && <SourceBadge>Qloo answer</SourceBadge>}
            </div>
            <h2 className="m-0 text-[20px] font-semibold leading-[1.25]">{r.question}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {r.options.map((o) => {
                const isAnswer = result?.answer === o.id;
                const isPick = result?.option === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={Boolean(result) || busy}
                    onClick={() => guess(o.id)}
                    className={cx(
                      "flex cursor-pointer flex-col items-start gap-0.5 rounded-md border-th bg-bg px-3.5 py-3 text-left font-body text-ink disabled:cursor-default",
                      !result && "border-line hover:bg-acc-soft",
                      result && isAnswer && "border-acc-line bg-acc-soft",
                      result && isPick && !isAnswer && "border-err",
                      result && !isAnswer && !isPick && "border-line opacity-70",
                    )}
                  >
                    <span className="text-body font-medium">
                      {o.label}
                      {result && isAnswer && " ✓"}
                      {result && isPick && !isAnswer && " ✗"}
                    </span>
                    <span className="text-chip text-mute">{result ? result.reveal[o.id] ?? o.meta : o.meta}</span>
                  </button>
                );
              })}
            </div>
            {result && (
              <p className={cx("m-0 text-body font-medium", result.correct ? "text-acc-text" : "text-err")}>
                {result.correct ? "Right: that's Qloo's pick." : "Not quite. The highlighted option is Qloo's pick."}
              </p>
            )}
          </Panel>
        );
      })}

      {done && (
        <Panel>
          <MonoLabel className="text-acc-text">Today&apos;s result</MonoLabel>
          <div className="t-display text-[44px] leading-none">
            {grid} {score}/{puzzle.rounds.length}
          </div>
          {stats && (
            <p className="m-0 text-chip text-mute">
              Played {stats.played} · all three right {stats.perfect} · streak {stats.streak} · best {stats.best}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => {
                const url = `${window.location.origin}/daily`;
                if (navigator.share) navigator.share({ text: shareText, url }).catch(() => {});
                else copy("share", `${shareText}\n${url}`);
              }}
            >
              {copied === "share" ? "Copied" : "Share result"}
            </Button>
            {saved.query && (
              <Link href={planHref(saved.query)} className="rounded-btn border-th border-line px-3 py-1.5 text-chip text-ink no-underline hover:bg-acc-soft">
                See the full {puzzle.fanbase} plan →
              </Link>
            )}
          </div>
          <p className="m-0 text-chip text-mute">A new fanbase tomorrow at midnight UTC.</p>
        </Panel>
      )}
    </>
  );
}
