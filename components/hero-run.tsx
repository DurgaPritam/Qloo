"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { STEPS } from "@/lib/agent/types";
import type { PlanSummary } from "@/lib/plan-summary";

import { planHref } from "./showcase";
import { cx, MonoLabel, SourceBadge } from "./ui";

const STEP_MS = 420;
const HOLD_MS = 3400;

/** What each step decided, from a stored real run only (no plans: the steps play without values). */
function decisions(p: PlanSummary | undefined): (string | null)[] {
  if (!p) return STEPS.map(() => null);
  return [
    p.fanbase,
    p.format,
    p.partner,
    p.populationRank > 1 ? `${p.city} · #${p.populationRank} by population` : p.city,
    p.venue ?? "Venue to confirm",
    "One-page brief",
    "Two email drafts",
  ];
}

const QUERY = "(prefers-reduced-motion: reduce)";
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia?.(QUERY);
      m?.addEventListener("change", onChange);
      return () => m?.removeEventListener("change", onChange);
    },
    () => Boolean(window.matchMedia?.(QUERY).matches),
    () => false,
  );
}

/**
 * The landing hero's live-run card: the agent's seven steps tick through one cached real plan at a
 * time, then the result, then the next plan. With reduced motion the steps show finished and the
 * plans change without the tick-through.
 */
export function HeroRun({ plans }: { plans: readonly PlanSummary[] }) {
  const [i, setI] = useState(0);
  const [ticked, setDone] = useState(0);
  const reduce = useReducedMotion();
  const done = reduce ? STEPS.length : ticked;

  useEffect(() => {
    if (reduce) {
      if (plans.length < 2) return;
      const id = setInterval(() => setI((n) => (n + 1) % plans.length), 6000);
      return () => clearInterval(id);
    }
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      step += 1;
      setDone(step);
      if (step < STEPS.length) timer = setTimeout(tick, STEP_MS);
      else
        timer = setTimeout(() => {
          step = 0;
          setDone(0);
          setI((n) => (plans.length ? (n + 1) % plans.length : 0));
          timer = setTimeout(tick, STEP_MS);
        }, HOLD_MS);
    };
    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [plans.length, reduce]);

  const p = plans[i];
  const values = decisions(p);
  const finished = done >= STEPS.length;

  return (
    <div className="relative">
      {/* A soft accent glow behind the card, in the theme's own accent tint. */}
      <div aria-hidden className="glow pointer-events-none absolute -inset-8 rounded-[40px] bg-[radial-gradient(closest-side,var(--acc-soft),transparent)] opacity-90" />
      <div className="relative flex flex-col gap-3 rounded-lg bg-surf p-panel border-card border-ink shadow-card" aria-label="An example run" role="figure">
        <div className="flex items-center justify-between gap-2">
          <MonoLabel>{p ? "A real run, replayed" : "How a run goes"}</MonoLabel>
          <span className="tabular font-mono text-label uppercase tracking-[0.08em] text-acc-text">
            {Math.min(done, STEPS.length)} / {STEPS.length}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-pill bg-track">
          <div
            className="h-full rounded-pill bg-acc-line transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${(Math.min(done, STEPS.length) / STEPS.length) * 100}%` }}
          />
        </div>
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {STEPS.map((s, n) => {
            const state = n < done ? "done" : n === done ? "running" : "waiting";
            return (
              <li
                key={s.id}
                className={cx(
                  "flex items-center gap-3 rounded-btn px-2 py-1.5 transition-colors duration-300",
                  state === "running" && "bg-acc-soft",
                  state === "waiting" && "opacity-45",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "size-2.5 flex-none rounded-pill",
                    state === "done" ? "bg-acc-line" : state === "running" ? "animate-dot bg-acc-line" : "border border-line bg-transparent",
                  )}
                />
                <span className="w-[2ch] font-mono text-label text-mute">{String(n + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 text-[15px] font-medium">{s.title}</span>
                <span className={cx("min-w-0 max-w-[55%] truncate text-right text-[14px] text-mute transition-opacity duration-300", state !== "done" && "opacity-0")}>
                  {values[n] ?? "✓"}
                </span>
              </li>
            );
          })}
        </ol>
        <div className={cx("flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3 transition-opacity duration-500", finished ? "opacity-100" : "opacity-30")}>
          {p ? (
            <>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="self-start">
                  <SourceBadge>Planned with Qloo</SourceBadge>
                </span>
                <span className="t-display text-[clamp(22px,2.4vw,30px)] leading-[1] [overflow-wrap:anywhere]">
                  {p.fanbase} × {p.partner}
                </span>
              </div>
              <Link href={planHref(p.query)} className="whitespace-nowrap text-[15px]">
                Open this plan →
              </Link>
            </>
          ) : (
            <span className="text-[15px] text-mute">Type a name or pick an example to run one.</span>
          )}
        </div>
      </div>
    </div>
  );
}
