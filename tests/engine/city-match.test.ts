import { describe, expect, it } from "vitest";

import { cityIndex, matchCity } from "@/lib/engine/city-match";
import { CITIES } from "@/lib/engine/data";
import { countryCode } from "@/lib/engine/markets";
import { metroCities } from "@/lib/engine/metro";

const index = cityIndex(CITIES, metroCities(CITIES));
const m = (raw: string, country?: string) => matchCity(raw, index, { country, countryCode });
const name = (raw: string, country?: string) => {
  const r = m(raw, country);
  return r.status === "matched" ? `${r.city.name}, ${r.city.country}` : r.status;
};

describe("matchCity", () => {
  it("matches GeoNames names across accents, case, St/Saint and a trailing City", () => {
    expect(name("Montreal")).toBe("Montréal, CA");
    expect(name("los angeles")).toBe("Los Angeles, US");
    expect(name("Saint Louis, MO")).toBe("St. Louis, US");
    expect(name("New York")).toBe("New York City, US");
    expect(name("NYC")).toBe("New York City, US");
  });

  it("folds boroughs into their metro and says so", () => {
    const r = m("Brooklyn");
    expect(r.status).toBe("matched");
    if (r.status === "matched") {
      expect(r.city.name).toBe("New York City");
      expect(r.note).toMatch(/Brooklyn counted in New York City/);
    }
  });

  it("takes a far larger namesake without asking, and narrows by region or country", () => {
    expect(name("London")).toBe("London, GB");
    expect(name("London, Ontario")).toBe("London, CA");
    expect(name("London", "Canada")).toBe("London, CA");
    expect(name("London", "CA")).toBe("London, CA");
    expect(name("Springfield, MO")).toBe("Springfield, US");
  });

  it("leaves close namesakes for a person to choose, largest first", () => {
    // St. Louis, Missouri and Saint-Louis, Senegal are of a similar size.
    expect(m("Saint Louis").status).toBe("ambiguous");
    const r = m("Springfield");
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.options.map((o) => o.admin1)).toEqual(["Missouri", "Massachusetts", "Illinois"]);
    }
  });

  it("reports names it cannot find, instead of guessing", () => {
    expect(m("Zzxq").status).toBe("unmatched");
    expect(m("").status).toBe("unmatched");
    expect(m("Portland, Maine").status).toBe("unmatched");
  });
});
