import { describe, expect, it } from "vitest";

import { scorePartners } from "@/lib/engine/partners";

import { candidate } from "./builders";

/**
 * Rules tuned on real Qloo data: popularity band 0.5–0.999, affinity compared
 * within each category (0 = category median, 1 = category best), score = relative affinity ×
 * (1 − popularity)^0.15.
 */
describe("scorePartners", () => {
  it("bias guard drops a mega-star (popularity above 0.999) even if its affinity is highest", () => {
    const res = scorePartners([
      candidate("megastar", "artist", 0.99, 0.9995),
      candidate("indie", "artist", 0.96, 0.97),
      candidate("film", "movie", 0.93, 0.96),
      candidate("show", "tv_show", 0.95, 0.9),
    ]);

    expect(res.picks.map((p) => p.entity.id)).not.toContain("megastar");
    expect(res.dropped).toContainEqual({ item: expect.objectContaining({ id: "megastar" }), reason: "too_popular" });
    expect(res.fallback).toBe(false);
  });

  it("drops candidates too little known to draw a crowd", () => {
    const res = scorePartners([candidate("unknown", "artist", 0.97, 0.2), candidate("known", "movie", 0.9, 0.95)]);
    expect(res.dropped).toContainEqual({ item: expect.objectContaining({ id: "unknown" }), reason: "too_obscure" });
  });

  it("returns fallback=true with a reason when there are no candidates", () => {
    const res = scorePartners([]);
    expect(res.picks).toEqual([]);
    expect(res.fallback).toBe(true);
    expect(res.reason).toMatch(/no partner candidates/i);
  });

  it("compares affinity within each category, so a high-scoring category does not win by default", () => {
    // TV shows all score ~0.95 (their category's level); the video game stands out in its own.
    const res = scorePartners([
      candidate("tv-a", "tv_show", 0.951, 0.95),
      candidate("tv-b", "tv_show", 0.95, 0.95),
      candidate("tv-c", "tv_show", 0.949, 0.95),
      candidate("game-top", "videogame", 0.9, 0.95),
      candidate("game-mid", "videogame", 0.85, 0.95),
      candidate("game-low", "videogame", 0.84, 0.95),
    ]);

    expect(res.picks[0].entity.id).toMatch(/^(game-top|tv-a)$/);
    expect(res.picks.find((p) => p.entity.id === "game-top")?.evidence.relativeAffinity).toBe(1);
    expect(res.dropped.filter((d) => d.reason === "below_min_affinity").map((d) => d.item.id).sort()).toEqual(["game-low", "tv-c"]);
  });

  it("discounts mainstream reach gently", () => {
    const res = scorePartners([candidate("mainstream", "artist", 0.95, 0.998), candidate("known", "movie", 0.95, 0.95)]);
    const score = (id: string) => res.picks.find((p) => p.entity.id === id)!.score;
    expect(score("known")).toBeCloseTo(Math.pow(0.05, 0.15));
    expect(score("mainstream")).toBeCloseTo(Math.pow(0.002, 0.15));
    expect(res.picks[0].entity.id).toBe("known");
  });

  it("returns the top 3 spanning at least 2 categories", () => {
    const res = scorePartners([
      candidate("a1", "artist", 0.99, 0.95),
      candidate("a2", "artist", 0.98, 0.95),
      candidate("a3", "artist", 0.97, 0.95),
      candidate("a4", "artist", 0.9, 0.95),
      candidate("m1", "movie", 0.9, 0.97),
    ]);

    expect(res.picks.map((p) => p.entity.id)).toContain("m1");
    expect(new Set(res.picks.map((p) => p.entity.category)).size).toBe(2);
    expect(res.fallback).toBe(false);
  });

  it("labels a single-category result as a fallback", () => {
    const res = scorePartners([
      candidate("a1", "artist", 0.99, 0.95),
      candidate("a2", "artist", 0.98, 0.95),
      candidate("a3", "artist", 0.97, 0.95),
    ]);
    expect(res.fallback).toBe(true);
    expect(res.reason).toMatch(/only one category/i);
  });

  it("falls back to the closest candidates when none clears the floor, never to the out-of-band", () => {
    const res = scorePartners(
      [candidate("megastar", "artist", 0.99, 0.9999), candidate("ok1", "artist", 0.95, 0.95), candidate("ok2", "movie", 0.9, 0.95)],
      { minAffinity: 1.5 },
    );
    expect(res.fallback).toBe(true);
    expect(res.picks.map((p) => p.entity.id).sort()).toEqual(["ok1", "ok2"]);
    expect(res.picks.every((p) => p.confidence === "low")).toBe(true);
    expect(res.reason).toMatch(/closest/i);
  });

  it("returns fallback with no picks when everything is outside the popularity band", () => {
    const res = scorePartners([candidate("megastar", "artist", 0.99, 0.9999), candidate("unknown", "movie", 0.99, 0.1)]);
    expect(res.picks).toEqual([]);
    expect(res.fallback).toBe(true);
    expect(res.reason).toMatch(/popularity band/i);
  });

  it("drops invalid data and excluded ids", () => {
    const res = scorePartners(
      [
        candidate("seed", "artist", 1, 0.95),
        candidate("nan", "artist", Number.NaN, 0.95),
        candidate("over", "movie", 1.4, 0.95),
        candidate("good", "movie", 0.9, 0.95),
      ],
      { excludeIds: ["seed"] },
    );
    expect(res.picks.map((p) => p.entity.id)).toEqual(["good"]);
    expect(res.dropped.map((d) => d.reason)).toEqual(["invalid_data", "invalid_data"]);
  });

  it("is deterministic on ties", () => {
    const input = [candidate("b", "artist", 0.9, 0.95), candidate("a", "movie", 0.9, 0.95)];
    expect(scorePartners(input).picks.map((p) => p.entity.id)).toEqual(["a", "b"]);
    expect(scorePartners([...input].reverse()).picks.map((p) => p.entity.id)).toEqual(["a", "b"]);
  });
});
