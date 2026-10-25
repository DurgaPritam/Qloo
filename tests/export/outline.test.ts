import { describe, expect, it } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Plan } from "@/lib/agent/types";
import { citiesCsv, deckOutline, exportFileName, exportFooter } from "@/lib/export/outline";
import { MOCK_BANNER } from "@/lib/mock-mode";
import { MockQlooSource } from "@/lib/qloo/mock";

function samplePlan(query = "Phoebe Bridgers"): Promise<Plan> {
  return runAgent(
    { query },
    { runId: "export-test", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} },
  );
}

describe("deckOutline", () => {
  it("covers the pair, city, tour, room, outreach and sources", async () => {
    const titles = deckOutline(await samplePlan()).map((s) => s.title);
    expect(titles[0]).toMatch(/^Tour stop: Phoebe Bridgers ×/);
    expect(titles.some((t) => t.startsWith("Where: "))).toBe(true);
    expect(titles.some((t) => /^Tour route: \d+ stops, [\d,]+ km$/.test(t))).toBe(true);
    expect(titles).toEqual(expect.arrayContaining(["Outreach drafts", "Sources"]));
  });

  it("never states capacity, dates or prices as numbers", async () => {
    const text = JSON.stringify(deckOutline(await samplePlan()));
    expect(text).toContain("to confirm with the promoter");
    expect(text).not.toMatch(/(capacit\w*|prices?|dates?)\W{0,3}\d|\d[\d,.]*\W{0,3}(capacit\w*|prices?|dates?)\b/i);
  });

  it("labels sample plans in the footer and file name", async () => {
    const plan = await samplePlan();
    expect(exportFooter(plan)).toBe(MOCK_BANNER);
    expect(exportFileName(plan, "pptx")).toMatch(/-sample\.pptx$/);
    expect(exportFooter({ ...plan, mock: false })).toMatch(/Qloo/);
  });
});

describe("citiesCsv", () => {
  it("has a header, one row per ranked city, tour order and the source on every row", async () => {
    const plan = await samplePlan();
    const lines = citiesCsv(plan).trim().split("\r\n");
    expect(lines[0]).toBe(
      "rank_with_qloo,population_rank,city,region,country,combined_0_100,fanbase_0_100,partner_0_100,confidence,tour_stop,leg_km,source",
    );
    expect(lines).toHaveLength(plan.city!.table.length + 1);
    expect(lines.slice(1).every((l) => l.endsWith(MOCK_BANNER))).toBe(true);
    expect(lines[1]).toMatch(/^1,/);
  });

  it("quotes cells with commas and quotes", async () => {
    const plan = await samplePlan();
    const row = plan.city!.table[0];
    const renamed = { ...row, pick: { ...row.pick, city: { ...row.pick.city, name: 'Rock, "Paper"' } } };
    expect(citiesCsv({ ...plan, city: { ...plan.city!, table: [renamed] } })).toContain('"Rock, ""Paper"""');
  });
});
