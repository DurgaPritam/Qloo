import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader, MonoLabel, Page, SourceBadge } from "@/components/ui";
import { DEFAULT_USER_WEIGHT } from "@/lib/engine/combine";
import { ENGINE_CONFIG as C } from "@/lib/engine/config";
import { QLOO_RUN_BUDGET } from "@/lib/qloo/client";

export const metadata: Metadata = { title: "How it works · Takeover" };

/** Every number on this page is read from lib/engine/config.ts, so it cannot drift from the code. */
const SECTIONS = [
  {
    label: "Taste data",
    title: "What Qloo tells us",
    body: [
      "Qloo's Taste AI links what people like across categories: music, film, TV, podcasts, books, brands and places. For any fanbase it returns other entities with an affinity score: how much more that fanbase likes them than people in general.",
      "It also returns a popularity percentile for each entity, and heatmaps: how strong an audience is in each patch of a country.",
    ],
  },
  {
    label: "Step 3",
    title: "Choosing the crossover partner",
    body: [
      "Candidates come from categories other than the fanbase's own. Affinity is compared within each category, because a TV show and a brand do not score on the same scale: 0 is the category's middle candidate, 1 its best.",
      `Popularity is kept between ${C.partners.minPopularity} and ${C.partners.maxPopularity}: above that are mega-stars and platforms every audience likes (YouTube, Netflix), below it entities too obscure to draw a crowd.`,
      `Score = relative affinity × (1 − popularity)^${C.partners.popularityExponent}, a gentle discount on the mainstream. The shortlist has ${C.partners.count} partners from at least ${C.partners.minCategories} categories.`,
    ],
  },
  {
    label: "Step 4",
    title: "Choosing the city",
    body: [
      "The fanbase's and the partner's heatmaps are read inside one market, the fanbase's home country. For each city, the cells within " +
        `${C.cities.radiusKm} km count: heat = affinity × local popularity, so a city needs real presence as well as over-indexing.`,
      "The two audiences are combined with a geometric mean, so a city must be strong for both. The table shows each city's rank by population next to its Qloo rank: the point is to find the city a population list would miss.",
      `If city-level data is thin, the radius widens to ${C.cities.regionalRadiusKm} km and the result is labelled "regional". Cities come from GeoNames; suburbs within ${C.cities.metroMergeKm} km are folded into their city.`,
    ],
  },
  {
    label: "Step 5",
    title: "Venue, opener and sponsors",
    body: [
      "Places come from Qloo with tags that fit the format (a comedy club for a tour stop, a cinema for a screening). Rooms built for a different size, such as a stadium for a podcast, are down-weighted.",
      `Sponsors are brands both audiences over-index on, with popularity up to ${C.brands.maxPopularity}. Nonprofits, government bodies and sports teams are not offered as sponsors. They are suggestions, never confirmed.`,
    ],
  },
  {
    label: "Steps 6 and 7",
    title: "The brief and the emails",
    body: [
      "The model writes the prose, with placeholders where names go. Code fills in every name, score and source, and any sentence that states a capacity, date, price or availability is replaced with “to confirm with the promoter”.",
      "The emails are drafts. Takeover never sends anything.",
    ],
  },
  {
    id: "your-data",
    label: "Your data",
    title: "Combining Qloo with your own numbers",
    body: [
      "A workspace can upload its own ticket sales, streams, signups or revenue by city. Those numbers are labelled Your data, are not checked by Takeover, stay inside the workspace and are never sent to the AI model.",
      "Your data = a city's total ÷ your best city's total, so your best city is 100. Qloo signal = the city's score from the heatmaps above, also 0 to 100 against the hottest city.",
      `Combined = (1 − w) × Qloo signal + w × Your data, where w is the weight on your data: ${DEFAULT_USER_WEIGHT} unless you move the slider. All three columns are always shown side by side; a city missing on one side is combined from the other side alone and shows a dash.`,
    ],
  },
  {
    label: "Confidence",
    title: "High, medium or low",
    body: [
      `Partners and cities are high confidence at ${C.confidence.high} and above, medium from ${C.confidence.medium} (relative affinity for partners, the weaker audience's heat for cities). Venues and sponsors are rated by how many qualified and how far the first is ahead of the second.`,
    ],
  },
  {
    label: "Limits",
    title: "What it won't do",
    body: [
      `Each plan uses at most ${QLOO_RUN_BUDGET} Qloo calls. Every step has a fallback that says what happened and carries on with the best result, labelled. Qloo knows tastes, not calendars, so capacity, dates, prices and availability are always left to the promoter.`,
    ],
  },
];

export default function MethodPage() {
  return (
    <Page>
      <AppHeader />
      <section className="flex flex-col gap-2 pt-4">
        <MonoLabel>How it works</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">How the scores work</h1>
        <p className="m-0 text-body text-mute [text-wrap:pretty]">
          Every pick in a plan is computed by code from Qloo data, and every score links back to the call behind it. This
          is what the code does.
        </p>
      </section>
      {SECTIONS.map((s) => (
        <section key={s.title} id={"id" in s ? s.id : undefined} className="flex scroll-mt-4 flex-col gap-2.5 border-t border-line pt-[18px]">
          <MonoLabel className="text-acc-text">{s.label}</MonoLabel>
          <h2 className="m-0 text-[20px] font-semibold leading-[1.2]">{s.title}</h2>
          {s.body.map((p) => (
            <p key={p} className="m-0 text-body [text-wrap:pretty]">
              {p}
            </p>
          ))}
        </section>
      ))}
      <section className="flex flex-wrap items-center gap-2 border-t border-line pb-[22px] pt-[18px]">
        <SourceBadge />
        <p className="m-0 text-body">
          The full reasoning behind each choice is in the project&apos;s decisions log. <Link href="/">Plan a takeover</Link>
        </p>
      </section>
    </Page>
  );
}
