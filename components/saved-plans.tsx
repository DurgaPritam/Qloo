"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { loadSaved, removeSaved, renameSaved, type SavedPlan } from "@/lib/saved-plans";

import { categoryLabel } from "./run/format";
import { planHref } from "./showcase";
import { Banner, Button, MonoLabel, OutlineChip, SourceBadge, cx, useCopy } from "./ui";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function SavedPlans() {
  const [plans, setPlans] = useState<SavedPlan[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  // localStorage exists only in the browser, so the list is read after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPlans(loadSaved()), []);

  if (plans === null) return null;
  if (plans.length === 0) {
    return (
      <Banner tone="neutral" action={<Link href="/explore">Explore examples</Link>}>
        No plans yet. Plan a takeover from the home page, or open an example; finished plans appear here.
      </Banner>
    );
  }

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const share = (p: SavedPlan) => (p.mock ? planHref(p.query) : `/plan/${p.runId}`);

  return (
    <section className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <MonoLabel>{plans.length} saved</MonoLabel>
        <div className="flex-1" />
        <span className="text-chip text-mute">{picked.length === 2 ? "Ready to compare" : "Pick two to compare"}</span>
        {picked.length === 2 ? (
          <Link
            href={`/compare?a=${picked[0]}&b=${picked[1]}`}
            className="rounded-btn bg-acc px-3 py-1.5 text-chip font-medium text-on-acc no-underline"
          >
            Compare
          </Link>
        ) : (
          <Button disabled>Compare</Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {plans.map((p) => {
          const on = picked.includes(p.runId);
          return (
            <article key={p.runId} className={cx("flex flex-col gap-2 rounded-md bg-surf p-[18px] border-card border-ink shadow-card", on && "outline outline-1 outline-acc-line")}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                  {editing === p.runId ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const title = new FormData(e.currentTarget).get("title");
                        setPlans(renameSaved(p.runId, String(title ?? "")));
                        setEditing(null);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        name="title"
                        defaultValue={p.title ?? `${p.fanbase} × ${p.partner}`}
                        aria-label="Plan name"
                        autoFocus
                        className="min-w-0 flex-1 rounded-btn border-th border-line bg-bg px-2.5 py-1.5 font-body text-body text-ink"
                      />
                      <Button type="submit" variant="primary">
                        Save
                      </Button>
                    </form>
                  ) : (
                    <Link href={share(p)} className="t-display text-[22px] leading-[1.05] text-ink no-underline hover:underline">
                      {p.title ?? `${p.fanbase} × ${p.partner}`}
                    </Link>
                  )}
                  <div className="text-chip text-mute">
                    {p.format} · {categoryLabel(p.partnerCategory)} partner {p.partner} · {p.city}
                    {p.venue ? ` · ${p.venue}` : ""}
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {p.mock ? <OutlineChip>Sample data</OutlineChip> : <SourceBadge />}
                    {p.sponsors.length > 0 && <OutlineChip>Sponsors · {p.sponsors.join(", ")}</OutlineChip>}
                    <OutlineChip>Saved {date(p.savedAt)}</OutlineChip>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant={on ? "primary" : "secondary"} aria-pressed={on} onClick={() => toggle(p.runId)}>
                    {on ? "Picked" : "Compare"}
                  </Button>
                  <Button onClick={() => copy(p.runId, new URL(share(p), window.location.origin).href)}>
                    {copied === p.runId ? "Copied" : "Copy link"}
                  </Button>
                  <Button onClick={() => setEditing(editing === p.runId ? null : p.runId)}>Rename</Button>
                  <Button
                    onClick={() => {
                      setPicked((x) => x.filter((id) => id !== p.runId));
                      setPlans(removeSaved(p.runId));
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
