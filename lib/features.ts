import { FEATURES, TIERS, tierFor, type Feature, type TierName } from "@/lib/entitlements";
import { EXAMPLES } from "@/lib/examples";

/**
 * Every feature Takeover has, in one place: the landing role picker, /guide, the help panel and
 * the getting-started checklist all read from here. The tier comes from lib/entitlements.ts, never
 * from this file. Copy rules (CLAUDE.md, onboarding prompt): describe only what exists, say which
 * numbers come from Qloo and which from Your data, and make no claims about results, reach or revenue.
 */
export const ROLE_KEYS = ["promoter", "venue", "brand", "manager", "fan"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const ROLES: { key: RoleKey; label: string }[] = [
  { key: "promoter", label: "Promoter or agent" },
  { key: "venue", label: "Venue" },
  { key: "brand", label: "Brand or sponsor" },
  { key: "manager", label: "Artist manager" },
  { key: "fan", label: "Just a fan" },
];

export type ChecklistKey = "run" | "roster" | "data" | "watch" | "invite";

export interface FeatureEntry {
  id: string;
  name: string;
  /** The page it lives on (tests check the page exists). */
  route: string;
  /** One line: what it gives you. */
  benefit: string;
  /** A few words for cards (landing role picker). */
  tagline: string;
  roles: RoleKey[];
  /** The entitlement that gates it (lib/entitlements.ts); null when it is free to use. */
  entitlement: Feature | null;
  /** Free to try, with more on a paid tier (e.g. more tour stops). */
  more?: Feature;
  /** Needs a signed-in workspace. */
  account: boolean;
  /** Which numbers it shows come from Qloo and which from Your data. */
  numbers: string;
  /** Searchable help text for the help panel and /guide. */
  help: string;
  /** A preloaded real run that shows it; shown only when that cached run exists (lib/features-server.ts). */
  example?: { label: string; query: string; hash?: string };
  /** The getting-started step it completes, ticked from the workspace's own data. */
  checklist?: { key: ChecklistKey; title: string; cta: string };
}

const PHOEBE = EXAMPLES[1].name;
const MULANEY = EXAMPLES[0].name;

export const REGISTRY: FeatureEntry[] = [
  {
    id: "plan",
    name: "Plan a takeover",
    route: "/",
    benefit: "Type any fanbase: the agent picks a crossover partner, a city, a venue and sponsors, then writes a brief and two outreach drafts.",
    tagline: "Partner, city, venue and brief for any fanbase.",
    roles: ["promoter", "fan", "manager", "venue", "brand"],
    entitlement: null,
    account: false,
    numbers: "Every score is Qloo affinity, computed by Takeover's engine. Capacity, dates and prices are always to confirm with the promoter.",
    help: "Each step shows what it decided and the Qloo call behind it. Swap the partner or the city and the later steps replan. Outreach is drafts only: Takeover never sends email.",
    example: { label: PHOEBE, query: PHOEBE },
    checklist: { key: "run", title: "Save a plan to the workspace", cta: "Plan a takeover" },
  },
  {
    id: "overlap",
    name: "Fan overlap",
    route: "/overlap",
    benefit: "Any two names: how much their fans overlap, in which cities, and who those fans are.",
    tagline: "How much two fanbases share, and where.",
    roles: ["fan", "brand", "promoter"],
    entitlement: null,
    account: false,
    numbers: "The overlap score and the city ranks are Qloo affinity.",
    help: "Type two fanbases. The score says how strongly each one's fans over-index on the other; it is not a share of fans.",
  },
  {
    id: "fan",
    name: "Meet the fan",
    route: "/fan",
    benefit: "Who a fanbase's fans are, and what else they love across music, TV, film, podcasts and brands.",
    tagline: "Who the fans are and what else they love.",
    roles: ["fan", "brand"],
    entitlement: null,
    account: false,
    numbers: "Ages, gender skew and interests are Qloo demographics and affinity.",
    help: "Qloo reports age bands and gender skew, not head counts; when it has no demographics the page says so.",
  },
  {
    id: "brand",
    name: "Brand match",
    route: "/brand",
    benefit: "The talent, shows and podcasts a brand's customers over-index on, and where those customers are.",
    tagline: "What a brand's customers over-index on.",
    roles: ["brand"],
    entitlement: null,
    account: false,
    numbers: "Matches and cities are Qloo affinity.",
    help: "Type a brand. Results list what its customers over-index on; a weak or missing match is labelled rather than filled in.",
  },
  {
    id: "venue",
    name: "Venue booker",
    route: "/venue",
    benefit: "The artists, comedians, podcasts and brands a city over-indexes on, for booking a room.",
    tagline: "What your city loves, for booking.",
    roles: ["venue", "promoter"],
    entitlement: null,
    account: false,
    numbers: "Rankings are Qloo affinity for the city.",
    help: "Pick a city to see what it is into. Capacity and availability are never shown: confirm them with the venue.",
  },
  {
    id: "cities",
    name: "City explorer",
    route: "/cities",
    benefit: "A fanbase's strongest cities at home and in three more countries.",
    tagline: "A fanbase's strongest cities, country by country.",
    roles: ["manager", "fan", "promoter"],
    entitlement: null,
    account: false,
    numbers: "City scores are Qloo affinity; population rank is shown beside them for comparison.",
    help: "Type a fanbase to see its strongest cities in each country, with the population rank beside each one.",
    example: { label: `${MULANEY} cities`, query: MULANEY, hash: "city" },
  },
  {
    id: "city",
    name: "City pages",
    route: "/city",
    benefit: "What a city over-indexes on, one page per city.",
    tagline: "What each big city is into.",
    roles: ["venue", "fan"],
    entitlement: null,
    account: false,
    numbers: "Everything listed is Qloo affinity for that city.",
    help: "City pages cover the big markets and music and comedy towns listed on /city.",
  },
  {
    id: "tour",
    name: "Tour optimizer",
    route: "/tour",
    benefit: "A route through a fanbase's strongest cities inside your dates, region and leg limits, with why strong cities were left off.",
    tagline: "A tour route through the strongest cities.",
    roles: ["manager", "promoter"],
    entitlement: null,
    more: "optimizers",
    account: false,
    numbers: "City scores are Qloo affinity; your window, dates and venue sizes are Your data.",
    help: `Free plans route up to ${TIERS.free.limits.tourStops} stops. Distances are computed from city coordinates; dates and venue sizes stay yours to confirm.`,
  },
  {
    id: "tour-planner",
    name: "Tour planner",
    route: "/tour/planner",
    benefit: "An editable itinerary from a tour route: draft dates, shows, rest days, venue, support act, sponsor and contacts per stop, with edits typed in plain words and CSV, calendar and PDF exports.",
    tagline: "Turn a route into an editable itinerary.",
    roles: ["manager", "promoter"],
    entitlement: null,
    more: "optimizers",
    account: false,
    numbers: "Heat scores and suggested venues, support acts and sponsors are Qloo affinity; dates you set, names, contacts and notes are Your data; other dates are drafts.",
    help: "Draft dates are counted from your start date and driving pace, never from the model, and stay to confirm with the promoter. Qloo suggestions run one stop at a time, only when you ask. Signed out, tours are kept in this browser.",
  },
  {
    id: "lineup",
    name: "Lineup optimizer",
    route: "/lineup",
    benefit: "From your pool of acts, fee tiers and budget: the bill with the strongest shared audience, and a poster.",
    tagline: "The strongest bill inside your budget.",
    roles: ["promoter", "venue"],
    entitlement: null,
    more: "optimizers",
    account: false,
    numbers: "Crowd fit and audience coverage are Qloo affinity; fee tiers, budget and slots are Your data.",
    help: `Free plans score a pool of up to ${TIERS.free.limits.lineupPool} acts. Must-include acts and the budget are never broken; near misses explain what didn't fit.`,
  },
  {
    id: "daily",
    name: "Takeover Daily",
    route: "/daily",
    benefit: "A new fanbase every day: guess its crossover partner, city and sponsor, then share your score.",
    tagline: "Guess today's crossover, city and sponsor.",
    roles: ["fan"],
    entitlement: null,
    account: false,
    numbers: "The answers come from Qloo taste data.",
    help: "One puzzle a day; your progress stays in this browser.",
  },
  {
    id: "explore",
    name: "Explore",
    route: "/explore",
    benefit: "Plans already run on real Qloo data, to open without waiting.",
    tagline: "Real plans, ready to open.",
    roles: ["fan", "promoter"],
    entitlement: null,
    account: false,
    numbers: "Each plan's scores are the Qloo results from when it was recorded; the date is shown.",
    help: "These are cached runs: they replay the original agent log and say when they were recorded.",
  },
  {
    id: "workspace-plans",
    name: "Workspace plans",
    route: "/workspace",
    benefit: "Plans saved for your team, private by default, with a link you can make public.",
    tagline: "Plans saved for your team.",
    roles: ["promoter", "manager", "brand", "venue"],
    entitlement: "workspace.plans",
    account: true,
    numbers: "Plans keep the Qloo scores from their run.",
    help: "Runs made while signed in on Pro or above are saved here. Free runs stay in My plans in your browser.",
  },
  {
    id: "rosters",
    name: "Rosters",
    route: "/workspace/rosters",
    benefit: "Group the acts you represent, see each act's best city, partner and sponsor, and the pairings inside the roster.",
    tagline: "Every act you represent, and their pairings.",
    roles: ["manager", "promoter"],
    entitlement: "rosters",
    account: true,
    numbers: "Pairing scores and best picks are Qloo affinity; home cities you add are Your data.",
    help: "A refresh shows how many Qloo calls it will use before it runs, and reuses scores for a week.",
    checklist: { key: "roster", title: "Create a roster", cta: "Create a roster" },
  },
  {
    id: "pipeline",
    name: "Pipeline",
    route: "/workspace/pipeline",
    benefit: "Track outreach from first draft to a confirmed date, with owners, due dates and reminders.",
    tagline: "Outreach from draft to confirmed date.",
    roles: ["promoter", "manager"],
    entitlement: "pipeline",
    account: true,
    numbers: "Everything on the board is Your data.",
    help: "Open a draft in your own mail app, then mark it sent. Takeover never sends on your behalf. Reminders go to the card's owner.",
  },
  {
    id: "watch",
    name: "Market watch",
    route: "/workspace/watch",
    benefit: "Follow fanbases and cities; each Monday Takeover re-checks Qloo and lists what changed week over week.",
    tagline: "What changed in your markets each week.",
    roles: ["venue", "promoter", "brand"],
    entitlement: "market.watch",
    account: true,
    numbers: "Changes are Qloo affinity, this week against last week.",
    help: "The first check records a starting point; changes show from the second week. The weekly digest email is opt-in per person.",
    checklist: { key: "watch", title: "Watch a fanbase or a city", cta: "Watch one" },
  },
  {
    id: "sponsorship",
    name: "Sponsorship matchmaker",
    route: "/workspace/sponsorship",
    benefit: "Match a brand with talent and events whose fans over-index on it, from either side, and shortlist them.",
    tagline: "Brands and talent whose fans already match.",
    roles: ["brand", "venue"],
    entitlement: "sponsorship",
    account: true,
    numbers: "Match scores are Qloo affinity; fees or budgets you add are Your data.",
    help: "When few brands pass your filters, a labelled fallback list from the team's home city is shown beside them.",
  },
  {
    id: "data",
    name: "Your data",
    route: "/workspace/data",
    benefit: "Upload a CSV or Excel export from ticketing or a CRM and see it next to Qloo signal, with a weight you set.",
    tagline: "Your sales next to Qloo signal.",
    roles: ["venue", "promoter", "brand"],
    entitlement: "data.uploads",
    account: true,
    numbers: "Your columns are Your data; rankings show Qloo signal, Your data and Combined in separate columns.",
    help: "Map the columns and review the rows before anything is used. Your data is never blended into Qloo's scores without your weight, and never shown to another workspace.",
    checklist: { key: "data", title: "Upload your data", cta: "Upload a CSV" },
  },
  {
    id: "outcomes",
    name: "Outcomes",
    route: "/workspace/outcomes",
    benefit: "Log what happened after an event and compare it with what the plan predicted.",
    tagline: "What happened against what was predicted.",
    roles: ["promoter", "venue"],
    entitlement: "outcomes",
    account: true,
    numbers: "Results you log are Your data; predictions come from the plan's Qloo scores.",
    help: "Predictions are frozen when the plan is made. A group is judged only once enough events are logged; until then the page shows how many it has of the number needed.",
  },
  {
    id: "campaign",
    name: "Campaign brief",
    route: "/workspace/campaign",
    benefit: "A targeting brief from a plan or a fanbase: audience, interests by category, cities, ad keywords and three creative angles.",
    tagline: "A targeting brief with ad keywords.",
    roles: ["brand"],
    entitlement: "campaign.briefs",
    account: true,
    numbers: "Every figure is Qloo signal. There are no reach, impressions, CPM or budget figures.",
    help: "Angles are written only from numbered facts in the brief. Download it as a PDF, a deck or a keywords CSV.",
  },
  {
    id: "members",
    name: "Members and comments",
    route: "/workspace/members",
    benefit: "Invite teammates as admins, members or viewers, and discuss any decision in a plan with comments and mentions.",
    tagline: "Teammates, roles and comments.",
    roles: ["promoter", "manager", "brand"],
    entitlement: "collaboration",
    account: true,
    numbers: "No scores here.",
    help: "Roles are Owner, Admin, Member and Viewer. Invitations go out only when you press Send.",
    checklist: { key: "invite", title: "Invite a teammate", cta: "Invite" },
  },
  {
    id: "decks",
    name: "Branded decks",
    route: "/workspace/settings/branding",
    benefit: "Decks and exports in your colours, font and logo, with a contrast check.",
    tagline: "Decks in your colours and logo.",
    roles: ["manager", "brand"],
    entitlement: "exports.branded",
    account: true,
    numbers: "Decks carry the plan's Qloo scores unchanged.",
    help: "Admins set the branding; every deck the workspace downloads uses it.",
  },
  {
    id: "api",
    name: "Public API",
    route: "/developers",
    benefit: "Fan overlap, fanbase cities, venues, brand matches and full plans over REST.",
    tagline: "Takeover's data over REST.",
    roles: ["brand", "promoter"],
    entitlement: "api",
    account: true,
    numbers: "Every response carries its Qloo evidence and attribution.",
    help: "Create keys in Settings → API. A key is shown once; Takeover keeps only a hash.",
  },
  {
    id: "white-label",
    name: "White-label",
    route: "/workspace/settings/white-label",
    benefit: "Shared plans and embeddable widgets under your brand and your own domain.",
    tagline: "Your brand on shared plans and widgets.",
    roles: ["brand", "venue"],
    entitlement: "white.label",
    account: true,
    numbers: "Widgets show Qloo figures with Qloo's attribution.",
    help: "A custom domain is verified by a DNS TXT record before it serves anything.",
  },
  {
    id: "settings",
    name: "Workspace settings",
    route: "/workspace/settings",
    benefit: "Name the workspace and set its time zone, currency and plan.",
    tagline: "Name, time zone, currency and plan.",
    roles: ["promoter", "manager", "brand", "venue"],
    entitlement: null,
    account: true,
    numbers: "No scores here.",
    help: "The time zone sets when the Monday watch runs; the currency labels results you log. Plans & billing and Usage are tabs here.",
  },
];

/** Three tools to start with, per role, on the landing page. */
export const ROLE_PICKS: Record<RoleKey, [string, string, string]> = {
  promoter: ["plan", "lineup", "pipeline"],
  venue: ["venue", "lineup", "watch"],
  brand: ["brand", "sponsorship", "campaign"],
  manager: ["rosters", "tour", "cities"],
  fan: ["plan", "overlap", "daily"],
};

/** General questions for the help panel, beside each feature's help text. */
export const HELP_TOPICS: { id: string; q: string; a: string; href: string }[] = [
  { id: "scores", q: "Where do the scores come from?", a: "From Qloo's taste data, turned into scores by Takeover's engine. The formulas are on How it works.", href: "/method" },
  {
    id: "your-data",
    q: "What is the difference between Qloo signal, Your data and Combined?",
    a: "◆ Qloo signal comes from Qloo. ■ Your data is anything you typed or uploaded. Combined blends the two with the weight you set.",
    href: "/method#your-data",
  },
  {
    id: "confirm",
    q: "Why are capacity, dates and prices “to confirm”?",
    a: "Takeover doesn't know venue availability or pricing, so it never shows them as numbers.",
    href: "/method",
  },
  { id: "email", q: "Does Takeover send email for me?", a: "No. Outreach is drafts only: copy them or open them in your own mail app.", href: "/method" },
  {
    id: "fallback",
    q: "What does “Fallback used” mean in the agent log?",
    a: "A step couldn't use its first choice, so it says what it did instead and carries on with the best result, labelled.",
    href: "/method",
  },
  {
    id: "cached",
    q: "What is a cached run?",
    a: "A plan recorded earlier on real Qloo data, replayed with its original log. It shows the date it was recorded.",
    href: "/explore",
  },
];

/** The run screen's guided tour: five targets marked with data-tour on the run screen. */
export const RUN_TOUR = [
  { target: "log", title: "The agent log", body: "Each step appears here in order, with what it decided and why." },
  { target: "qloo", title: "The Qloo call behind a step", body: "Open ◆ Qloo call on a finished step to see the request and parameters its decision came from." },
  { target: "swap", title: "Swap the partner", body: "Prefer another partner? Pick one from the shortlist and the city, venue, brief and outreach replan around it." },
  { target: "brief", title: "The brief", body: "A one-page partner brief. Each pick shows its reason and source; capacity, dates and prices stay “to confirm with the promoter”." },
  { target: "outreach", title: "Outreach drafts", body: "Emails to copy into your own inbox. Takeover never sends email." },
] as const;
export const TOUR_STORAGE_KEY = "tk.runTour.done";

/* ---------- Derived ---------- */

export const featureById = (id: string): FeatureEntry => {
  const f = REGISTRY.find((x) => x.id === id);
  if (!f) throw new Error(`No feature "${id}" in lib/features.ts`);
  return f;
};

/** The lowest tier that has it (lib/entitlements.ts). */
export const tierOf = (f: FeatureEntry): TierName => (f.entitlement ? tierFor(f.entitlement) : "free");

/** "Team: Full tour and lineup optimizers, saved tours", for features free to try with more on a paid tier. */
export const moreOf = (f: FeatureEntry): string | null => (f.more ? `${TIERS[tierFor(f.more)].label}: ${FEATURES[f.more]}` : null);

export const featuresForRole = (role: RoleKey) => REGISTRY.filter((f) => f.roles.includes(role));

export const CHECKLIST = REGISTRY.flatMap((f) => (f.checklist ? [{ ...f.checklist, feature: f }] : []));

/** The registry entry whose route a path belongs to (the longest match). */
export function featureForPath(path: string): FeatureEntry | null {
  const hits = REGISTRY.filter((f) => (f.route === "/" ? path === "/" : path === f.route || path.startsWith(`${f.route}/`)));
  return hits.sort((a, b) => b.route.length - a.route.length)[0] ?? null;
}

export interface RoleCard {
  id: string;
  name: string;
  tier: TierName;
  benefit: string;
  tagline: string;
  more: string | null;
  route: string;
  account: boolean;
  /** A cached real run, when one exists (lib/onboarding/examples.ts). */
  example: { label: string; href: string } | null;
}

/** The landing role picker's three cards per role. */
export function roleCards(examples: Record<string, { label: string; href: string }>): Record<RoleKey, RoleCard[]> {
  const card = (id: string): RoleCard => {
    const f = featureById(id);
    return { id, name: f.name, tier: tierOf(f), benefit: f.benefit, tagline: f.tagline, more: moreOf(f), route: f.route, account: f.account, example: examples[id] ?? null };
  };
  return Object.fromEntries(ROLE_KEYS.map((r) => [r, ROLE_PICKS[r].map(card)])) as Record<RoleKey, RoleCard[]>;
}
