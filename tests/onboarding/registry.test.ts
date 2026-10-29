import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { searchHelp } from "@/components/onboarding/help";
import { FEATURES, isTier, TIER_NAMES, TIERS, tierFor } from "@/lib/entitlements";
import { SHOWCASE } from "@/lib/examples";
import { CHECKLIST, HELP_TOPICS, REGISTRY, ROLE_KEYS, ROLE_PICKS, RUN_TOUR, tierOf } from "@/lib/features";
import { NAV, TOOLS, WORKSPACE_NAV, WORKSPACE_TOOLS } from "@/lib/site";

const pageFor = (route: string) => `app${route === "/" ? "" : route}/page.tsx`;

describe("the feature registry", () => {
  it("has an entry for every page in the sidebar and the tools menus", () => {
    const routes = new Set(REGISTRY.map((f) => f.route));
    const menus = [...WORKSPACE_NAV, ...WORKSPACE_TOOLS, ...TOOLS].map((i) => i.href);
    expect(
      menus.filter((href) => !routes.has(href)),
      "add these to lib/features.ts",
    ).toEqual([]);
  });

  it("points only at routes that exist, and every menu link is a real page", () => {
    for (const f of REGISTRY) expect(existsSync(pageFor(f.route)), `${f.id} → ${f.route}`).toBe(true);
    for (const item of [...NAV, ...WORKSPACE_NAV, ...WORKSPACE_TOOLS, ...TOOLS]) expect(existsSync(pageFor(item.href)), item.href).toBe(true);
    for (const t of HELP_TOPICS) expect(existsSync(pageFor(t.href.split("#")[0])), t.href).toBe(true);
  });

  it("is well formed: unique ids, known roles, three picks per role, tiers only from lib/entitlements", () => {
    expect(new Set(REGISTRY.map((f) => f.id)).size).toBe(REGISTRY.length);
    for (const f of REGISTRY) {
      expect(f.roles.length, f.id).toBeGreaterThan(0);
      for (const r of f.roles) expect(ROLE_KEYS).toContain(r);
      if (f.entitlement) expect(Object.keys(FEATURES)).toContain(f.entitlement);
      expect(tierOf(f)).toBe(f.entitlement ? tierFor(f.entitlement) : "free");
      expect(isTier(tierOf(f))).toBe(true);
      for (const field of [f.name, f.benefit, f.numbers, f.help]) expect(field.trim().length, f.id).toBeGreaterThan(0);
    }
    for (const r of ROLE_KEYS) {
      expect(ROLE_PICKS[r]).toHaveLength(3);
      for (const id of ROLE_PICKS[r]) expect(REGISTRY.find((f) => f.id === id)?.roles, `${r}: ${id}`).toContain(r);
    }
    expect(CHECKLIST.map((c) => c.key).sort()).toEqual(["data", "invite", "roster", "run", "watch"]);
    expect(RUN_TOUR).toHaveLength(5);
  });

  it("examples name only preloaded runs (they show only when the cached real run exists)", () => {
    for (const f of REGISTRY) if (f.example) expect(SHOWCASE, f.id).toContain(f.example.query);
  });

  it("follows the copy rules: says where numbers come from, no claims about results, reach or revenue, no invented figures", () => {
    const claims = /\b(guarantee\w*|boost\w*|increase\w*|grow\w*|sell(s|ing)? out|more (tickets|sales|fans|revenue)|ROI|roi|viral|best[- ]in[- ]class|instantly)\b/i;
    const allowedNumbers = new Set(TIER_NAMES.flatMap((t) => Object.values(TIERS[t].limits).flatMap((v) => (typeof v === "number" ? [String(v)] : [])))).add("1");
    const texts = [...REGISTRY.flatMap((f) => [f.name, f.benefit, f.numbers, f.help]), ...HELP_TOPICS.flatMap((t) => [t.q, t.a]), ...RUN_TOUR.flatMap((t) => [t.title, t.body])];
    for (const t of texts) {
      expect(t, t).not.toMatch(claims);
      // "reach" and "revenue" may only appear to say they are not shown.
      if (/\b(reach|revenue)\b/i.test(t)) expect(t).toMatch(/\bno (reach|revenue)\b/i);
      for (const n of t.match(/\d+/g) ?? []) expect(allowedNumbers.has(n), `${n} in “${t}”`).toBe(true);
    }
    for (const f of REGISTRY) expect(f.numbers, f.id).toMatch(/Qloo|Your data|No scores/);
  });

  it("feeds the help panel: its search finds features by their help text and links formulas to /method", () => {
    expect(searchHelp("CSV").map((a) => a.id)).toContain("data");
    expect(searchHelp("stops").map((a) => a.id)).toContain("tour");
    expect(searchHelp("zzzz-nothing")).toEqual([]);
    expect(searchHelp("scores come from").find((a) => a.id === "scores")?.href).toBe("/method");
    expect(searchHelp("").length).toBe(REGISTRY.length + HELP_TOPICS.length);
  });
});
