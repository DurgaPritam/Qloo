/**
 * The one place that knows what each plan tier includes. Every gated route and screen
 * asks this module; no other code compares tiers. Change pricing here and nothing else moves.
 * Limit numbers are placeholders until pricing is confirmed.
 *
 * The rule for downgrades: reading what a workspace already stored is never gated, so a downgrade
 * leaves its data read-only; anything that creates, changes or spends Qloo calls is.
 */
export const TIER_NAMES = ["free", "pro", "team", "enterprise"] as const;
export type TierName = (typeof TIER_NAMES)[number];

export const FEATURES = {
  "workspace.plans": "Save plans to a workspace",
  "exports.branded": "Branded decks and exports",
  pipeline: "Outreach pipeline (CRM)",
  "campaign.briefs": "Campaign briefs",
  "team.seats": "More seats: invite your team",
  collaboration: "Comments, mentions and roles",
  rosters: "Roster intelligence",
  optimizers: "Full tour and lineup optimizers, saved tours",
  "data.uploads": "Your data + Qloo",
  "market.watch": "Market watch and the weekly digest",
  sponsorship: "Sponsorship matchmaker",
  outcomes: "Outcome reports",
  api: "Public API",
  "white.label": "White-label: your brand, domain and widgets",
} as const;
export type Feature = keyof typeof FEATURES;

/** What every tier has, Free included. */
export const FREE_INCLUDES = ["Today's tools", "The Daily game", "Single plans, signed out or in"];

export interface Limits {
  /** Plans saved to the workspace per calendar month (UTC); null: unlimited. */
  plansPerMonth: number | null;
  /** Acts per roster. */
  rosterActs: number;
  /** Fanbases and cities watched. */
  watchItems: number;
  /** Members (Team: the seats bought; this many when none were bought, e.g. set by hand). */
  seats: number | null;
  /** Qloo calls per workspace per month. */
  qlooMonthly: number;
  api: { perMinute: number; monthly: number; keys: number };
  /** Lineup optimizer pool size, and tour optimizer stops. */
  lineupPool: number;
  tourStops: number;
}

export interface TierInfo {
  label: string;
  blurb: string;
  /** Features this tier adds to the ones below it. */
  adds: Feature[];
  limits: Limits;
  /** Self-serve through Stripe; Enterprise is assigned by hand after "Contact us". */
  checkout: boolean;
}

export const TIERS: Record<TierName, TierInfo> = {
  free: {
    label: "Free",
    blurb: "Today's tools, the Daily game, single plans and signed-out use.",
    adds: [],
    limits: { plansPerMonth: 0, rosterActs: 0, watchItems: 0, seats: 1, qlooMonthly: 200, api: { perMinute: 0, monthly: 0, keys: 0 }, lineupPool: 4, tourStops: 4 },
    checkout: false,
  },
  pro: {
    label: "Pro",
    blurb: "A saved workspace, branded exports, the outreach CRM and campaign briefs.",
    adds: ["workspace.plans", "exports.branded", "pipeline", "campaign.briefs"],
    limits: { plansPerMonth: 50, rosterActs: 0, watchItems: 0, seats: 1, qlooMonthly: 1000, api: { perMinute: 0, monthly: 0, keys: 0 }, lineupPool: 6, tourStops: 6 },
    checkout: true,
  },
  team: {
    label: "Team",
    blurb: "Seats, roster intelligence, collaboration, and the tour and lineup optimizers.",
    adds: ["team.seats", "collaboration", "rosters", "optimizers"],
    limits: { plansPerMonth: 200, rosterActs: 40, watchItems: 0, seats: 3, qlooMonthly: 3000, api: { perMinute: 0, monthly: 0, keys: 0 }, lineupPool: 10, tourStops: 12 },
    checkout: true,
  },
  enterprise: {
    label: "Enterprise",
    blurb: "Your data + Qloo, market watch, sponsorship, outcome reports, the API and white-label.",
    adds: ["data.uploads", "market.watch", "sponsorship", "outcomes", "api", "white.label"],
    limits: { plansPerMonth: null, rosterActs: 100, watchItems: 30, seats: null, qlooMonthly: 10000, api: { perMinute: 60, monthly: 10000, keys: 10 }, lineupPool: 10, tourStops: 12 },
    checkout: false,
  },
};

export const PLACEHOLDER_NOTE = "Limits are placeholders until pricing is confirmed.";

export const isTier = (x: unknown): x is TierName => typeof x === "string" && (TIER_NAMES as readonly string[]).includes(x);
const tierOrFree = (t: string | null | undefined): TierName => (isTier(t) ? t : "free");
const rank = (t: TierName) => TIER_NAMES.indexOf(t);

/** Every feature a tier has: its own and those of the tiers below it. */
export function featuresOf(tier: string | null | undefined): Feature[] {
  const t = tierOrFree(tier);
  return TIER_NAMES.slice(0, rank(t) + 1).flatMap((n) => TIERS[n].adds);
}

export const has = (tier: string | null | undefined, feature: Feature): boolean => featuresOf(tier).includes(feature);

/** The tier's limits; Team is priced per seat, so its seats are the seats bought. */
export function limitsOf(tier: string | null | undefined, opts: { seatsBought?: number | null } = {}): Limits {
  const t = tierOrFree(tier);
  const l = TIERS[t].limits;
  return perSeat(t) && opts.seatsBought ? { ...l, seats: opts.seatsBought } : l;
}

/** Tiers whose Stripe price is per seat (the subscription's quantity is its seats). */
export const perSeat = (tier: string | null | undefined): boolean => tierOrFree(tier) === "team";

/** How a tier is had: included for everyone, bought through Stripe Checkout, or set up after "Contact us". */
export const howToGet = (tier: TierName): "included" | "checkout" | "contact" => (TIERS[tier].checkout ? "checkout" : rank(tier) === 0 ? "included" : "contact");

/** Tiers bought through Stripe Checkout. */
export const SELF_SERVE: TierName[] = TIER_NAMES.filter((t) => TIERS[t].checkout);

/**
 * The tier a Stripe subscription gives a workspace. A paid tier holds while the subscription is
 * active, trialing, or past_due (Stripe is retrying the card); unpaid, canceled or incomplete
 * falls back to Free, which keeps the workspace's data read-only.
 */
export function tierForSubscription(sub: { tier: string | null; status: string | null } | null): TierName {
  if (!sub || !isTier(sub.tier) || !TIERS[sub.tier].checkout) return "free";
  return liveSubscription(sub.status) ? sub.tier : "free";
}

/** Stripe statuses under which a subscription still holds its tier (past_due: Stripe is retrying the card). */
export const liveSubscription = (status: string | null | undefined): boolean => status === "active" || status === "trialing" || status === "past_due";

/** Whether billing may change a workspace's tier: not when it was assigned by hand (Enterprise). */
export const billingManaged = (current: string | null | undefined): boolean => {
  const t = tierOrFree(current);
  return t === "free" || TIERS[t].checkout;
};

/** The lowest tier that includes a feature. */
export function tierFor(feature: Feature): TierName {
  return TIER_NAMES.find((n) => TIERS[n].adds.includes(feature))!;
}

/** The lowest tier above this one whose limit is higher, for "upgrade to raise the limit". */
export function nextTierFor(tier: string | null | undefined, limit: keyof Omit<Limits, "api">): TierName | null {
  const t = tierOrFree(tier);
  const value = (n: TierName) => TIERS[n].limits[limit] ?? Infinity;
  return TIER_NAMES.slice(rank(t) + 1).find((n) => value(n) > value(t)) ?? null;
}

/** What an upgrade prompt shows: the tier that unlocks the feature, and everything it adds. */
export interface Upgrade {
  feature: Feature | null;
  reason: string;
  tier: TierName;
  label: string;
  unlocks: string[];
  selfServe: boolean;
}

export function upgradeFor(feature: Feature, reason?: string): Upgrade {
  const tier = tierFor(feature);
  return { feature, reason: reason ?? `${FEATURES[feature]} comes with ${TIERS[tier].label}.`, tier, label: TIERS[tier].label, unlocks: TIERS[tier].adds.map((f) => FEATURES[f]), selfServe: TIERS[tier].checkout };
}

export function upgradeForLimit(current: string | null | undefined, limit: keyof Omit<Limits, "api">, reason: string): Upgrade | null {
  const next = nextTierFor(current, limit);
  if (!next) return null;
  return { feature: null, reason, tier: next, label: TIERS[next].label, unlocks: TIERS[next].adds.map((f) => FEATURES[f]), selfServe: TIERS[next].checkout };
}
