import type { Plan } from "@/lib/agent/types";
import { TO_CONFIRM } from "@/lib/agent/types";
import { CATEGORY_LABEL } from "@/lib/engine/explain";
import { MOCK_BANNER } from "@/lib/mock-mode";

/**
 * Exports are built from the finished plan only. Every number comes from engine data in the
 * plan; nothing is added here except labels. Sample plans carry the sample-data label everywhere.
 */

export interface SlideOutline {
  title: string;
  subtitle?: string;
  bullets?: string[];
  table?: { columns: string[]; rows: string[][] };
  note?: string;
}

const two = (x: number) => x.toFixed(2);
const pct = (x: number) => String(Math.round(x * 100));
const km = (x: number) => `${x.toLocaleString("en-GB")} km`;

export function exportFooter(plan: Plan): string {
  return plan.mock ? MOCK_BANNER : "Scores computed by Takeover from Qloo taste data.";
}

export function deckOutline(plan: Plan): SlideOutline[] {
  const slides: SlideOutline[] = [];
  const brief = plan.brief;
  const fanbase = plan.fanbase?.name ?? plan.query;
  const chosen = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId) ?? plan.partners?.picks[0];

  slides.push({
    title: brief?.title ?? `${fanbase} takeover`,
    subtitle: brief?.headline,
    note: plan.status === "complete" ? undefined : "Partial plan: some steps could not finish.",
  });

  if (plan.partners && chosen) {
    slides.push({
      title: `${fanbase} × ${chosen.pick.entity.name}`,
      subtitle: chosen.explanation,
      table: {
        columns: ["Partner", "Type", "Affinity", "Popularity", "Score"],
        rows: plan.partners.picks.map(({ pick }) => [
          pick.entity.name,
          CATEGORY_LABEL[pick.entity.category],
          two(pick.entity.affinity),
          two(pick.entity.popularity),
          pct(pick.score),
        ]),
      },
      note: plan.partners.reason,
    });
  }

  const city = plan.city;
  if (city?.chosen) {
    slides.push({
      title: `Where: ${city.chosen.pick.city.name}`,
      subtitle: city.chosen.explanation,
      table: {
        columns: ["City", "Combined", "With Qloo", "Population"],
        rows: city.table.map(({ pick }) => [
          `${pick.city.name}, ${pick.city.country}`,
          pct(pick.combined),
          `#${pick.rank}`,
          `#${pick.populationRank}`,
        ]),
      },
      note: city.populationPick ? `Population alone would pick ${city.populationPick.city.name}.` : undefined,
    });
    if (city.tour.stops.length > 1) {
      slides.push({
        title: `Tour route: ${city.tour.stops.length} stops, ${km(city.tour.totalKm)}`,
        table: {
          columns: ["Stop", "City", "Combined", "Leg"],
          rows: city.tour.stops.map((s, i) => [
            String(i + 1),
            `${s.city.name}, ${s.city.country}`,
            pct(s.combined),
            i === 0 ? "start" : km(s.legKm),
          ]),
        },
        note: `Ordered to keep travel short; straight-line distances. Dates and routing are ${TO_CONFIRM}.`,
      });
    }
  }

  const room = plan.room;
  if (room) {
    const bullets: string[] = [];
    if (room.movedFrom) bullets.push(`No tagged venues in ${room.movedFrom.cityName}; using ${room.cityName}, ${km(room.movedFrom.distanceKm)} away.`);
    bullets.push(room.venue ? `Venue: ${room.venue.explanation}` : "Venue: none found.");
    if (room.opener) bullets.push(`Opener or host: ${room.opener.explanation}`);
    if (room.spots.length) bullets.push(`After-show spots: ${room.spots.map((s) => s.pick.place.name).join(", ")}.`);
    if (room.sponsors.length) bullets.push(`Sponsors: ${room.sponsors.map((s) => s.pick.brand.name).join(", ")}.`);
    bullets.push(`Capacity, dates, price and availability: ${TO_CONFIRM}.`);
    slides.push({ title: `Room & sponsors in ${room.cityName}`, bullets });
  }

  if (plan.outreach) {
    slides.push({
      title: "Outreach drafts",
      bullets: plan.outreach.map((m) => `To ${m.recipient}: “${m.subject}”`),
      note: "Drafts only. Takeover never sends email.",
    });
  }

  if (brief) {
    slides.push({
      title: "Sources",
      bullets: brief.items.map((i) => `${i.label}: ${i.source}`),
      note: "Every pick is backed by Qloo taste data. Nothing Qloo doesn't know is invented.",
    });
  }
  return slides;
}

/** One CSV row per scored city, with tour order where the city is a stop. */
export function citiesCsv(plan: Plan): string {
  const source = plan.mock ? MOCK_BANNER : "Qloo heatmap; GeoNames";
  const tourIndex = new Map(plan.city?.tour.stops.map((s, i) => [s.city.id, { stop: i + 1, legKm: s.legKm }]) ?? []);
  const header = [
    "rank_with_qloo",
    "population_rank",
    "city",
    "region",
    "country",
    "combined_0_100",
    "fanbase_0_100",
    "partner_0_100",
    "confidence",
    "tour_stop",
    "leg_km",
    "source",
  ];
  const rows = (plan.city?.table ?? []).map(({ pick }) => {
    const t = tourIndex.get(pick.city.id);
    return [
      pick.rank,
      pick.populationRank,
      pick.city.name,
      pick.city.admin1,
      pick.city.country,
      pct(pick.combined),
      pct(pick.sA),
      pct(pick.sB),
      pick.confidence,
      t?.stop ?? "",
      t ? t.legKm : "",
      source,
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportFileName(plan: Plan, ext: string): string {
  const base = (plan.brief?.title ?? `${plan.fanbase?.name ?? plan.query} takeover`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return `${base || "takeover"}${plan.mock ? "-sample" : ""}.${ext}`;
}
