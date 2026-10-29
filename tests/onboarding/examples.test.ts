import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WhatCanIDo } from "@/components/onboarding/role-picker";
import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Plan } from "@/lib/agent/types";
import { featureById, roleCards, ROLE_KEYS, ROLE_PICKS } from "@/lib/features";
import { exampleFor, resolvedExamples } from "@/lib/onboarding/examples";
import { MockQlooSource } from "@/lib/qloo/mock";
import { saveRecording, type Recording } from "@/lib/server/replay";

/** A recording as scripts/warm-cache.ts stores it from a live run (not sample data). */
async function liveRecording(query: string): Promise<Recording> {
  const plan = await runAgent({ query }, { runId: `r-${query}`, source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
  const live: Plan = { ...plan, mock: false };
  return { query, recordedAt: "2026-10-20T10:00:00Z", events: [{ at: 0, event: { step: "final", status: "done", summary: "done", data: live } as never }], plan: live };
}

describe("role picker examples", () => {
  it("open cached real runs only: a stored live recording, never sample mode or a missing run", async () => {
    const phoebe = await liveRecording("Phoebe Bridgers");
    const store = new Map([[phoebe.query, phoebe]]);
    const load = async (q: string) => store.get(q) ?? null;
    const plan = featureById("plan");

    expect(await exampleFor(plan, { mock: false, load })).toEqual({ label: "Phoebe Bridgers", href: "/run?q=Phoebe%20Bridgers" });
    expect(await exampleFor(plan, { mock: true, load })).toBeNull(); // sample mode: no examples at all
    expect(await exampleFor(featureById("cities"), { mock: false, load })).toBeNull(); // John Mulaney isn't stored
    expect(await exampleFor(featureById("overlap"), { mock: false, load })).toBeNull(); // no example defined
    const sample = { ...phoebe, plan: { ...phoebe.plan, mock: true } };
    expect(await exampleFor(plan, { mock: false, load: async () => sample })).toBeNull();
    await expect(saveRecording(sample)).rejects.toThrow(/mock/);
  });

  it("every Try link on the landing page is a cached real run; the rest open the tool itself", async () => {
    const phoebe = await liveRecording("Phoebe Bridgers");
    const examples = await resolvedExamples({ mock: false, load: async (q) => (q === phoebe.query ? phoebe : null) });
    const cards = roleCards(examples);
    for (const role of ROLE_KEYS) {
      expect(cards[role].map((c) => c.id)).toEqual(ROLE_PICKS[role]);
      const html = renderToStaticMarkup(createElement(WhatCanIDo, { cards: { ...cards, promoter: cards[role] } }));
      const tries = [...html.matchAll(/<a[^>]*data-example[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*data-example/g)].map((m) => (m[1] ?? m[2]).replace(/&amp;/g, "&"));
      for (const href of tries) expect(href).toBe("/run?q=Phoebe%20Bridgers");
      expect(tries.length).toBe(cards[role].filter((c) => c.example).length);
    }
    // In sample mode the page has no Try links at all.
    const none = roleCards(await resolvedExamples({ mock: true }));
    expect(ROLE_KEYS.flatMap((r) => none[r]).every((c) => c.example === null)).toBe(true);
    expect(renderToStaticMarkup(createElement(WhatCanIDo, { cards: none }))).not.toContain("data-example");
  });
});
