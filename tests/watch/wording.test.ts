import { describe, expect, it } from "vitest";

import { alertText, safeRephrase, tagFor } from "@/lib/watch/wording";

const item = { name: "Ali Wong", kind: "fanbase" as const };

describe("alert wording", () => {
  it("is filled from the diff only: names, ranks and values from both snapshots", () => {
    const rising = alertText({ list: "cities", entityId: "1", name: "Austin", kind: "rank_up", before: { rank: 6, value: 0.7 }, after: { rank: 2, value: 0.79 } }, item);
    expect(rising).toEqual({ title: "Austin up 4 places in the top cities for Ali Wong", body: "Rank #6 → #2; Qloo value 70 → 79 among Ali Wong fans." });
    const added = alertText({ list: "partners", entityId: "2", name: "Hot Ones", kind: "new", before: null, after: { rank: 3, value: 0.91 } }, item);
    expect(added.title).toBe("Hot Ones entered the top crossover partners for Ali Wong");
    expect(added.body).toBe("Now #3 at 91 / 100; it was not in the top list last week.");
    const cooling = alertText({ list: "category:podcast", entityId: "3", name: "SmartLess", kind: "value_down", before: { rank: 2, value: 0.9 }, after: { rank: 3, value: 0.82 } }, { name: "Austin", kind: "city" });
    expect(cooling.title).toBe("People in Austin cooling on SmartLess");
    expect(cooling.body).toBe("Down 8 points, 90 → 82; rank #2 → #3 in the top podcasts.");
    expect([tagFor({ kind: "new" }), tagFor({ kind: "rank_up" }), tagFor({ kind: "value_down" })]).toEqual(["New entry", "Rising", "Falling"]);
  });

  it("takes the model's rephrasing only when it keeps every number and name and adds none", () => {
    const t = "Rank #6 → #2; Qloo value 70 → 79 among Ali Wong fans.";
    const names = ["Austin", "Ali Wong"];
    const good = "Ali Wong fans moved Austin from #6 to #2, with Qloo value going from 70 to 79.";
    expect(safeRephrase(t, good, names)).toBe(t); // adds the name Austin: refused
    const same = "Among Ali Wong fans the rank went #6 → #2 and the Qloo value 70 → 79.";
    expect(safeRephrase(t, same, names)).toBe(same);
    expect(safeRephrase(t, "Rank #6 → #2; value 70 → 85 among Ali Wong fans.", names)).toBe(t);
    expect(safeRephrase(t, "Rank #6 → #2; Qloo value 70 → 79 among Ali Wong fans, up 12% on 2025.", names)).toBe(t);
    expect(safeRephrase(t, "", names)).toBe(t);
    expect(safeRephrase(t, null, names)).toBe(t);
  });

  it("words a drop out of the top list from the two snapshots only", () => {
    const item = { name: "Ali Wong", kind: "fanbase" as const };
    const lower = alertText({ list: "partners", entityId: "4", name: "Bon Appétit", kind: "dropped", before: { rank: 3, value: 0.8 }, after: { rank: 12, value: 0.61 } }, item);
    expect(lower).toEqual({ title: "Bon Appétit dropped out of the top crossover partners for Ali Wong", body: "Was #3 at 80 / 100 last week; now #12 at 61 / 100, below the top list." });
    expect(tagFor({ kind: "dropped" })).toBe("Falling");
  });
});
