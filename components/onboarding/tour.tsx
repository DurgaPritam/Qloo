"use client";

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref, type RefObject } from "react";

import { RUN_TOUR, TOUR_STORAGE_KEY } from "@/lib/features";
import { markTourSeen, tourAutoStarts, tourStep, type TourAction } from "@/lib/onboarding/tour";

import { Button, cx } from "../ui";

/** Fired by the help panel's "Take the run tour" on a run page. */
export const TOUR_EVENT = "takeover:tour";

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The run screen's five-step tour. It opens by itself once per browser when a run finishes (or
 * when asked with ?tour=1), is always skippable (Skip or Esc), and restarts from the help panel.
 * → and ← move between steps; focus goes to Next on each step and back where it was afterwards.
 */
export function useRunTour({ ready, asked, onStep }: { ready: boolean; asked: boolean; onStep?: (target: string) => void }) {
  const [step, setStep] = useState<number | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const total = RUN_TOUR.length;

  const act = useCallback(
    (action: TourAction) => {
      setStep((s) => {
        if (action === "start" && s === null) returnFocus.current = document.activeElement as HTMLElement | null;
        const next = tourStep(s, action, total);
        if (next.finished) markTourSeen(storage(), TOUR_STORAGE_KEY);
        if (next.step === null && s !== null) setTimeout(() => returnFocus.current?.focus?.(), 0);
        return next.step;
      });
    },
    [total],
  );

  useEffect(() => {
    if (!ready || !tourAutoStarts(storage(), TOUR_STORAGE_KEY, asked)) return;
    const id = setTimeout(() => act("start"), 400);
    return () => clearTimeout(id);
  }, [ready, asked, act]);

  useEffect(() => {
    const restart = () => act("start");
    window.addEventListener(TOUR_EVENT, restart);
    return () => window.removeEventListener(TOUR_EVENT, restart);
  }, [act]);

  useEffect(() => {
    if (step !== null) onStep?.(RUN_TOUR[step].target);
    // onStep is a fresh closure each render; the step is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") act("skip");
      else if (e.key === "ArrowRight") act("next");
      else if (e.key === "ArrowLeft") act("back");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, act]);

  return {
    step,
    total,
    active: step !== null,
    current: step === null ? null : RUN_TOUR[step],
    start: () => act("start"),
    next: () => act("next"),
    back: () => act("back"),
    skip: () => act("skip"),
  };
}

type Tour = ReturnType<typeof useRunTour>;
type Pos = { ring: { l: number; t: number; w: number; h: number }; tl: number; tt: number; tw: number };

/** The first visible element for a target (the run screen has a mobile and a desktop log). */
function targetIn(root: HTMLElement, target: string): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`));
  return all.find((el) => el.getBoundingClientRect().width > 0) ?? null;
}

/** Spotlight and tooltip, placed beside the target when it fits, else above or below. `rootRef` must be position: relative. */
export function TourOverlay({ rootRef, tour }: { rootRef: RefObject<HTMLElement | null>; tour: Tour }) {
  const [pos, setPos] = useState<Pos | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const target = tour.current?.target;

  const measure = useCallback(
    (scroll: boolean) => {
      const root = rootRef.current;
      if (!root || !target) return;
      const el = targetIn(root, target) ?? targetIn(root, "log");
      if (!el) return;
      const rr = root.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const W = rr.width;
      const pad = 6;
      const gap = 12;
      const ring = { l: r.left - rr.left - pad, t: r.top - rr.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
      const tw = Math.min(320, W - 32);
      const th = tipRef.current?.offsetHeight ?? 190;
      let tl: number;
      let tt: number;
      if (W - (ring.l + ring.w) >= tw + gap + 16) {
        tl = ring.l + ring.w + gap;
        tt = ring.t;
      } else if (ring.l >= tw + gap + 16) {
        tl = ring.l - gap - tw;
        tt = ring.t;
      } else {
        tl = Math.max(16, Math.min(W - tw - 16, ring.l + 16));
        tt = ring.t - th - gap > 0 ? ring.t - th - gap : ring.h < 360 ? ring.t + ring.h + gap : ring.t + 44;
      }
      setPos({ ring, tl, tt, tw });
      if (scroll) window.scrollTo({ top: Math.max(0, rr.top + window.scrollY + Math.min(tt, ring.t) - 72), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    },
    [rootRef, target],
  );

  useLayoutEffect(() => {
    if (!tour.active) return;
    const a = setTimeout(() => measure(true), 40);
    const b = setTimeout(() => measure(false), 360);
    const onResize = () => measure(false);
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
      window.removeEventListener("resize", onResize);
    };
  }, [tour.active, tour.step, measure]);

  // Focus Next once the tip is placed (it is hidden until measured), on every step. Retried for a
  // few frames: the run screen may still be re-rendering around it.
  const placed = pos !== null;
  useEffect(() => {
    if (!tour.active || !placed) return;
    let frames = 0;
    let id = 0;
    const tryFocus = () => {
      const btn = nextRef.current;
      if (btn && document.activeElement !== btn) btn.focus({ preventScroll: true });
      if (document.activeElement !== btn && frames++ < 20) id = requestAnimationFrame(tryFocus);
    };
    id = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(id);
  }, [tour.active, tour.step, placed]);

  if (!tour.active || !tour.current) return null;
  const i = tour.step!;
  const ring = pos?.ring;
  const scrim = "pointer-events-none absolute z-40 bg-[var(--scrim)]";
  return (
    <>
      {ring && (
        <>
          {/* Four panels around the target and a ring, rather than one huge box-shadow. */}
          <div aria-hidden className={cx(scrim, "inset-x-0 top-0")} style={{ height: Math.max(0, ring.t) }} />
          <div aria-hidden className={cx(scrim, "inset-x-0 bottom-0")} style={{ top: ring.t + ring.h }} />
          <div aria-hidden className={cx(scrim, "left-0")} style={{ top: ring.t, width: Math.max(0, ring.l), height: ring.h }} />
          <div aria-hidden className={cx(scrim, "right-0")} style={{ top: ring.t, left: ring.l + ring.w, height: ring.h }} />
          <div
            aria-hidden
            className="pointer-events-none absolute z-40 box-border rounded-[10px] border-2 border-acc-line"
            style={{ left: ring.l, top: ring.t, width: ring.w, height: ring.h }}
          />
        </>
      )}
      <TourTooltip
        ref={tipRef}
        nextRef={nextRef}
        step={i}
        total={tour.total}
        title={tour.current.title}
        body={tour.current.body}
        last={i === tour.total - 1}
        onNext={tour.next}
        onBack={tour.back}
        onSkip={tour.skip}
        style={pos ? { left: pos.tl, top: pos.tt, width: pos.tw } : { left: 16, top: 16, width: 320, visibility: "hidden" }}
      />
    </>
  );
}

export const TourTooltip = forwardRef<
  HTMLDivElement,
  {
    step: number;
    total: number;
    title: string;
    body: string;
    last?: boolean;
    onNext: () => void;
    onBack: () => void;
    onSkip: () => void;
    style?: CSSProperties;
    nextRef?: Ref<HTMLButtonElement>;
  }
>(function TourTooltip({ step, total, title, body, last, onNext, onBack, onSkip, style, nextRef }, ref) {
  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby="tk-tour-title"
      aria-describedby="tk-tour-body"
      data-tour-tip={step + 1}
      style={style}
      className="absolute z-[41] box-border flex max-w-[calc(100%-32px)] flex-col gap-2 rounded-md border-th border-line bg-surf p-4 font-body text-ink shadow-pop transition-[left,top] duration-200 motion-reduce:transition-none"
    >
      <div className="flex items-center gap-2.5">
        <span className="tabular flex-1 font-mono text-label uppercase tracking-[0.08em] text-acc-text">
          Tip {step + 1} of {total}
        </span>
        <ProgressDots step={step} total={total} />
      </div>
      <div id="tk-tour-title" className="text-[16px] font-semibold leading-[1.3]">
        {title}
      </div>
      <div id="tk-tour-body" className="text-body text-mute [text-wrap:pretty]">
        {body}
      </div>
      <div className="flex items-center gap-2 pt-1.5">
        <button type="button" onClick={onSkip} className="min-h-9 cursor-pointer border-0 bg-transparent p-0 font-body text-chip text-mute hover:text-ink">
          Skip tour
        </button>
        <span className="flex-1" />
        <Button onClick={onBack} disabled={step === 0} className="min-h-9">
          Back
        </Button>
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="min-h-9 cursor-pointer rounded-btn bg-acc px-3.5 py-[7px] font-body text-chip font-semibold text-on-acc border-card border-ink shadow-card hover:brightness-110"
        >
          {last ? "Done" : "Next"}
        </button>
      </div>
    </div>
  );
});

export const ProgressDots = ({ step, total }: { step: number; total: number }) => (
  <div role="img" aria-label={`Tip ${step + 1} of ${total}`} className="flex items-center gap-1">
    {Array.from({ length: total }, (_, i) => (
      <span
        key={i}
        className={cx("h-1.5 rounded-pill transition-[width] duration-200 motion-reduce:transition-none", i === step ? "w-4" : "w-1.5", i <= step ? "bg-acc-line" : "bg-track")}
      />
    ))}
  </div>
);
