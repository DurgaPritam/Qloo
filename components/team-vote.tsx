"use client";

import { useEffect, useState } from "react";

import type { Plan } from "@/lib/agent/types";

import { categoryLabel } from "./run/format";
import { Button, MonoLabel, Panel, ScoreBar, cx, useCopy } from "./ui";

type Question = "partner" | "city";
type State = Record<Question, { counts: Record<string, number>; mine: string | null }>;

/** Teammates open the shared link and vote on the shortlist; one vote each, changeable. */
export function TeamVote({ plan }: { plan: Plan }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  useEffect(() => {
    let live = true;
    fetch(`/api/votes?runId=${plan.runId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: State | null) => live && s && setState(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [plan.runId]);

  const vote = async (question: Question, option: string) => {
    setError(null);
    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: plan.runId, question, option }),
    }).catch(() => null);
    const body = res ? ((await res.json()) as State & { error?: string }) : null;
    if (res?.ok && body) setState(body);
    else setError(body?.error ?? "Your vote could not be saved. Try again.");
  };

  const groups: Array<{ q: Question; title: string; options: Array<{ id: string; name: string; meta: string }> }> = [
    {
      q: "partner",
      title: "Which partner?",
      options: (plan.partners?.picks ?? []).map((p) => ({ id: p.pick.entity.id, name: p.pick.entity.name, meta: categoryLabel(p.pick.entity.category) })),
    },
    {
      q: "city",
      title: "Which city?",
      options: (plan.city?.table ?? []).map((t) => ({ id: t.pick.city.id, name: t.pick.city.name, meta: `Qloo #${t.pick.rank} · #${t.pick.populationRank} by population` })),
    },
  ];

  return (
    <Panel>
      <div id="vote" className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel className="text-acc-text">Team vote</MonoLabel>
        <Button onClick={() => copy("vote", window.location.href.split("#")[0] + "#vote")}>{copied ? "Link copied" : "Copy link for your team"}</Button>
      </div>
      <p className="m-0 text-chip text-mute">
        Share this page; everyone with the link can vote once on each question and change their mind. No sign-up.
      </p>
      {error && <p className="m-0 text-chip text-err">{error}</p>}
      <div className="grid gap-[22px] md:grid-cols-2">
        {groups.map((g) => {
          const counts = state?.[g.q].counts ?? {};
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          return (
            <div key={g.q} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-body font-medium">{g.title}</span>
                <span className="text-chip text-mute">{total ? `${total} vote${total === 1 ? "" : "s"}` : "No votes yet"}</span>
              </div>
              {g.options.map((o) => {
                const mine = state?.[g.q].mine === o.id;
                const n = counts[o.id] ?? 0;
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={mine}
                    onClick={() => vote(g.q, o.id)}
                    className={cx(
                      "flex cursor-pointer flex-col gap-1.5 rounded-md border-th bg-bg px-3.5 py-2.5 text-left font-body text-ink",
                      mine ? "border-acc-line" : "border-line hover:bg-acc-soft",
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-body">
                        {o.name}
                        {mine && <span className="ml-2 font-mono text-label uppercase tracking-[0.06em] text-acc-text">Your vote</span>}
                      </span>
                      <span className="text-chip text-mute">{o.meta}</span>
                    </span>
                    <ScoreBar value={total ? Math.round((n / total) * 100) : 0} label={`${n} vote${n === 1 ? "" : "s"}`} />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
