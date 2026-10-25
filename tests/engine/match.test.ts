import { describe, expect, it } from "vitest";

import { classifyMatches, foldName, nameSimilarity } from "@/lib/engine/match";
import type { Entity } from "@/lib/engine/types";

const entity = (id: string, name: string, category: Entity["category"], popularity = 0.5): Entity => ({
  id,
  name,
  category,
  popularity,
});

describe("nameSimilarity", () => {
  it("folds case, accents, punctuation and a leading 'the'", () => {
    expect(foldName("The Beyoncé & Co.")).toBe("beyonce and co");
    expect(nameSimilarity("beyonce", "Beyoncé")).toBe(1);
    expect(nameSimilarity("Beyonse", "Beyoncé")).toBeCloseTo(6 / 7);
  });
});

describe("classifyMatches", () => {
  it("resolves a single same-name match", () => {
    const res = classifyMatches("john mulaney", [
      entity("a", "John Mulaney", "person"),
      entity("b", "John Mulaney: Baby J", "movie"),
    ]);
    expect(res).toMatchObject({ kind: "resolved", entity: { id: "a" } });
  });

  it("is ambiguous when the same name exists in two categories with similar reach", () => {
    const res = classifyMatches("Mercury", [
      entity("artist", "Mercury", "artist", 0.6),
      entity("film", "Mercury", "movie", 0.55),
    ]);
    expect(res.kind).toBe("ambiguous");
    if (res.kind === "ambiguous") expect(res.options.map((o) => o.entity.id)).toEqual(["artist", "film"]);
  });

  it("resolves to the dominant entity when the other is much less known", () => {
    const res = classifyMatches("Drake", [
      entity("artist", "Drake", "artist", 0.95),
      entity("film", "Drake", "movie", 0.2),
    ]);
    expect(res).toMatchObject({ kind: "resolved", entity: { id: "artist" } });
  });

  it("does not treat same-category duplicates as ambiguous", () => {
    const res = classifyMatches("Drake", [
      entity("a1", "Drake", "artist", 0.9),
      entity("a2", "Drake", "artist", 0.85),
    ]);
    expect(res).toMatchObject({ kind: "resolved", entity: { id: "a1" } });
  });

  it("suggests near spellings, closest first", () => {
    const res = classifyMatches("Kevn Hart", [
      entity("x", "Kevin Bacon", "person"),
      entity("k", "Kevin Hart", "person"),
    ]);
    expect(res.kind).toBe("did_you_mean");
    if (res.kind === "did_you_mean") expect(res.options[0].entity.id).toBe("k");
  });

  it("asks about common misspellings instead of guessing", () => {
    for (const [typed, real] of [["Kevn Hart", "Kevin Hart"], ["Billie Elish", "Billie Eilish"]]) {
      expect(classifyMatches(typed, [entity("e", real, "person")]).kind).toBe("did_you_mean");
    }
  });

  it("returns none for nothing close", () => {
    expect(classifyMatches("xqzvbnmlkj", [entity("a", "Taylor Swift", "artist")])).toEqual({ kind: "none" });
    expect(classifyMatches("anything", [])).toEqual({ kind: "none" });
  });
});

describe("names in other scripts", () => {
  it("matches a query in Devanagari against Qloo's other names", () => {
    const arijit = { ...entity("a", "Arijit Singh", "person", 0.99), aliases: ["अरिजीत सिंह", "Arijit Singh"] };
    expect(classifyMatches("अरिजीत सिंह", [arijit])).toMatchObject({ kind: "resolved", entity: { id: "a" } });
  });

  it("keeps vowel signs in Indic scripts while folding Latin accents", () => {
    expect(foldName("अरिजीत")).toBe("अरिजीत".normalize("NFKD"));
    expect(foldName("Beyoncé")).toBe("beyonce");
  });
});

describe("aliases stay out of Latin-script matching", () => {
  it("does not treat a short alias as an exact match for a Latin query", () => {
    const club = { ...entity("club", "Phoenix Mercury", "brand", 0.95), aliases: ["Mercury"] };
    const band = entity("band", "Mercury", "artist", 0.75);
    expect(classifyMatches("Mercury", [club, band])).toMatchObject({ kind: "resolved", entity: { id: "band" } });
  });
});
