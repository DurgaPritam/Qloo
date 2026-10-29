import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { BriefView } from "@/components/workspace/campaign";
import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import { briefNumbers, type CampaignBriefData } from "@/lib/campaign/brief";
import { makeBrief } from "@/lib/campaign/service";
import type { DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import type { LLMProvider } from "@/lib/llm/types";
import { MockQlooSource } from "@/lib/qloo/mock";

import { addUser, testDb } from "../support/db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

/**
 * The campaign brief's PDF is the printed brief page ([data-print-page]; the toolbar is hidden in
 * print). Every number on it must come from the engine (Qloo figures), Qloo's own names, or the
 * user. The deck and CSV are checked in campaign.test.ts.
 */
let db: DB;
const numbersIn = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];
const model = (text: string): LLMProvider =>
  ({ name: "gemini", model: "test", chat: () => ({}) as never, complete: async () => ({ text, refused: false }) }) as unknown as LLMProvider;

function printedText(brief: CampaignBriefData, workspace: string): string {
  const html = renderToStaticMarkup(createElement(BriefView, { id: "b1", brief, workspace, canDelete: true }));
  const page = html.slice(html.lastIndexOf("<article", html.indexOf("data-print-page")));
  return page
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/\s+/g, " ");
}

function allowedNumbers(brief: CampaignBriefData, user: string[]): Set<string> {
  const qlooNames = [
    brief.fanbase.name,
    brief.partner ?? "",
    ...brief.interests.flatMap((g) => g.items.flatMap((i) => [i.name, ...i.tags])),
    ...brief.cities.map((c) => c.name),
    ...brief.keywords.flatMap((k) => k.keywords),
  ];
  // The printed date line, and list positions (01, 02, …).
  const date = new Date(brief.createdAt);
  const positions = Array.from({ length: 20 }, (_, i) => [String(i + 1), String(i + 1).padStart(2, "0")]).flat();
  return new Set([
    ...briefNumbers(brief),
    ...qlooNames.flatMap(numbersIn),
    ...user.flatMap(numbersIn),
    String(date.getUTCDate()),
    String(date.getUTCFullYear()),
    ...positions,
    "0",
    "1",
    "100",
  ]);
}

beforeAll(async () => {
  ({ db } = await testDb());
});

describe("the brief's PDF (printed page)", () => {
  it("has no number that didn't come from the engine, Qloo's names or the user, even when the model tries to add one", async () => {
    const user = await addUser(db, "print@brief.test", "print");
    const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
    const repo = forWorkspace(db, { userId: user.id, workspaceId, role: "owner" });
    const template = await runAgent({ query: "Phoebe Bridgers" }, { runId: "t", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
    const planId = crypto.randomUUID();
    await repo.plans.create({ id: planId, query: "Phoebe Bridgers", result: { ...template, runId: planId } });
    const inputs = { title: "Late Set Spring", flight: "March 2027" };
    const workspace = "North Star 7";

    for (const angles of [null, model('[{"title":"Big","body":"Reach 2 million fans for $40k","facts":["F1"]}]')]) {
      const made = await makeBrief(repo, { planId, ...inputs }, { source: new MockQlooSource(), model: angles, now: new Date("2026-10-28T10:00:00Z") });
      if (made.status !== "done") throw new Error(made.status);
      const text = printedText(made.brief, workspace);
      expect(text).toContain(made.brief.title);
      const allowed = allowedNumbers(made.brief, [inputs.title, inputs.flight, workspace]);
      // Fact ids (F1…) are labels; "Qloo #3" and "population #12" are engine ranks, already allowed.
      const stray = numbersIn(text.replace(/\bF\d+\b/g, "")).filter((n) => !allowed.has(n));
      expect(stray, text).toEqual([]);
      expect(text).not.toMatch(/\b(reach|impressions|CPM|budget)\s*:/i);
    }
  });
});
