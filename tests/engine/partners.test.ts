import { describe, expect, it } from "vitest";

import { scorePartners } from "@/lib/engine/partners";

import { candidate } from "./builders";

describe("scorePartners", () => {
  it("bias guard drops an entity with pop 0.99 even if its affinity is highest", () => {
    const res = scorePartners([
      candidate("megastar", "artist", 0.99, 0.99),
      candidate("indie", "artist", 0.7, 0.3),
      candidate("film", "movie", 0.6, 0.4),
      candidate("show", "tv_show", 0.5, 0.2),
    ]);

    expect(res.picks.map((p) => p.entity.id)).not.toContain("megastar");
    expect(res.dropped).toContainEqual({
      item: expect.objectContaining({ id: "megastar" }),
      reason: "too_popular",
    });
    expect(res.fallback).toBe(false);
  });

  it("returns fallback=true with a reason when there are no candidates", () => {
    const res = scorePartners([]);

    expect(res.picks).toEqual([]);
    expect(res.fallback).toBe(true);
    expect(res.reason).toMatch(/no partner candidates/i);
  });

  it("scores affinity * (1 - pop)^0.5 so a niche match beats a mainstream one", () => {
    const res = scorePartners([
      candidate("mainstream", "artist", 0.9, 0.8),
      candidate("niche", "movie", 0.7, 0.2),
    ]);

    expect(res.picks[0].entity.id).toBe("niche");
    expect(res.picks[0].score).toBeCloseTo(0.7 * Math.sqrt(0.8));
    expect(res.picks[1].score).toBeCloseTo(0.9 * Math.sqrt(0.2));
  });

  it("returns the top 3 spanning at least 2 categories", () => {
    const res = scorePartners([
      candidate("a1", "artist", 0.9, 0.1),
      candidate("a2", "artist", 0.85, 0.1),
      candidate("a3", "artist", 0.8, 0.1),
      candidate("m1", "movie", 0.4, 0.1),
    ]);

    expect(res.picks.map((p) => p.entity.id)).toEqual(["a1", "a2", "m1"]);
    expect(res.picks.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(res.fallback).toBe(false);
  });

  it("labels a single-category result as a fallback", () => {
    const res = scorePartners([
      candidate("a1", "artist", 0.9, 0.1),
      candidate("a2", "artist", 0.8, 0.1),
      candidate("a3", "artist", 0.7, 0.1),
    ]);

    expect(res.picks).toHaveLength(3);
    expect(res.fallback).toBe(true);
    expect(res.reason).toMatch(/only one category/i);
  });

  it("drops candidates below minAffinity", () => {
    const res = scorePartners(
      [
        candidate("weak", "artist", 0.2, 0.1),
        candidate("ok1", "artist", 0.6, 0.1),
        candidate("ok2", "movie", 0.5, 0.1),
        candidate("ok3", "podcast", 0.5, 0.2),
      ],
      { minAffinity: 0.3 },
    );

    expect(res.dropped).toEqual([
      { item: expect.objectContaining({ id: "weak" }), reason: "below_min_affinity" },
    ]);
    expect(res.reason).toMatch(/1 below the affinity floor/);
  });

  it("falls back to the best below-floor candidates, never to too-popular ones", () => {
    const res = scorePartners([
      candidate("megastar", "artist", 0.95, 0.99),
      candidate("weak1", "artist", 0.2, 0.1),
      candidate("weak2", "movie", 0.1, 0.1),
    ]);

    expect(res.fallback).toBe(true);
    expect(res.picks.map((p) => p.entity.id)).toEqual(["weak1", "weak2"]);
    expect(res.picks.every((p) => p.confidence === "low")).toBe(true);
    expect(res.reason).toMatch(/closest below/i);
  });

  it("returns fallback with no picks when everything is too popular", () => {
    const res = scorePartners([candidate("megastar", "artist", 0.95, 0.99)]);

    expect(res.picks).toEqual([]);
    expect(res.fallback).toBe(true);
    expect(res.reason).toMatch(/bias guard/i);
  });

  it("drops invalid data and excluded ids", () => {
    const res = scorePartners(
      [
        candidate("seed", "artist", 1, 0.5),
        candidate("nan", "artist", Number.NaN, 0.1),
        candidate("over", "movie", 1.4, 0.1),
        candidate("good", "movie", 0.6, 0.1),
      ],
      { excludeIds: ["seed"] },
    );

    expect(res.picks.map((p) => p.entity.id)).toEqual(["good"]);
    expect(res.dropped.map((d) => d.reason)).toEqual(["invalid_data", "invalid_data"]);
  });

  it("is deterministic on ties", () => {
    const input = [candidate("b", "artist", 0.5, 0.5), candidate("a", "movie", 0.5, 0.5)];
    expect(scorePartners(input).picks.map((p) => p.entity.id)).toEqual(["a", "b"]);
    expect(scorePartners([...input].reverse()).picks.map((p) => p.entity.id)).toEqual(["a", "b"]);
  });
});
