import "server-only";

import type { WorkspaceRepo } from "@/lib/db/scoped";
import { FEATURES, FREE_INCLUDES, has, howToGet, perSeat, isTier, TIER_NAMES, TIERS, upgradeForLimit, type Limits, type TierName, type Upgrade } from "@/lib/entitlements";
import { workspaceUsage } from "@/lib/qloo/allowance";
import { planOf } from "@/lib/workspace/gate";
import { can } from "@/lib/workspace/permissions";

import { invoiceViews, priceViews, stripeConfig, type InvoiceView, type PriceView } from "./stripe";

/** One line of the usage page: a count from the database or the Qloo counters, against the tier's limit. */
export interface UsageRow {
  key: string;
  label: string;
  used: number;
  /** null: unlimited; 0: not on this plan. */
  limit: number | null;
  /** The tier that raises this limit, when there is one. */
  upgrade: Upgrade | null;
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function usageRows(repo: WorkspaceRepo, now = new Date()): Promise<UsageRow[]> {
  const plan = await planOf(repo);
  const role = repo.context.role;
  const [plans, members, pending, qloo, api, watch, rosters] = await Promise.all([
    repo.plans.countSince(monthStart(now)),
    repo.members.list(),
    can(role, "member.invite") ? repo.invitations.listPending() : Promise.resolve([]),
    workspaceUsage(repo.context.workspaceId, { now }),
    can(role, "api.read") ? orNull(repo.api.usage(now.toISOString().slice(0, 7))) : Promise.resolve(null),
    repo.watch.items(),
    repo.rosters.list(),
  ]);
  const row = (key: keyof Omit<Limits, "api">, label: string, used: number, limit = plan.limits[key]): UsageRow => ({
    key,
    label,
    used,
    limit,
    upgrade: limit !== null && used >= limit ? upgradeForLimit(plan.tier, key, `${label}: ${used} of ${limit}.`) : null,
  });
  const rows = [
    row("plansPerMonth", "Plans saved this month", plans),
    row("qlooMonthly", "Qloo calls this month", qloo.used, qloo.allowance),
    row("seats", "Seats (members and pending invitations)", members.length + pending.length),
    row("rosterActs", "Acts on the largest roster", Math.max(0, ...rosters.map((r) => Number(r.acts)))),
    row("watchItems", "Fanbases and cities watched", watch.length),
  ];
  if (has(plan.tier, "api") || api?.length) {
    const used = api?.find((u) => u.endpoint === "*")?.count ?? 0;
    rows.push({ key: "api", label: "API calls this month", used, limit: plan.limits.api.monthly, upgrade: null });
  }
  return rows;
}

export interface TierCard {
  tier: TierName;
  label: string;
  blurb: string;
  features: string[];
  selfServe: boolean;
  get: "included" | "checkout" | "contact";
  perSeat: boolean;
  /** Stripe's prices for this tier, by interval; empty until prices are set up. */
  prices: PriceView[];
}

export interface BillingView {
  tier: TierName;
  canManage: boolean;
  /** Why the plans can't be bought here right now, or null. */
  notReady: string | null;
  cards: TierCard[];
  subscription: {
    status: string | null;
    interval: string | null;
    seats: number | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    paymentFailed: boolean;
    hasCustomer: boolean;
  } | null;
  invoices: InvoiceView[] | null;
  /** Seats the workspace already uses: the least a per-seat checkout may buy. */
  seatsInUse: number;
}

export async function billingView(repo: WorkspaceRepo): Promise<BillingView> {
  const plan = await planOf(repo);
  const role = repo.context.role;
  const found = stripeConfig();
  const [sub, members, pending] = await Promise.all([
    can(role, "billing.read") ? repo.billing.get() : null,
    repo.members.list(),
    can(role, "member.invite") ? repo.invitations.listPending() : [],
  ]);
  const [prices, invoices] = found.ok
    ? await Promise.all([priceViews(found.config), sub?.stripeCustomerId ? orNull(invoiceViews(found.config, sub.stripeCustomerId)) : Promise.resolve(null)])
    : [[], null];
  return {
    tier: isTier(plan.tier) ? plan.tier : "free",
    canManage: can(role, "billing.manage"),
    notReady: found.ok ? null : found.reason,
    cards: TIER_NAMES.map((t) => ({
      tier: t,
      label: TIERS[t].label,
      blurb: TIERS[t].blurb,
      features: TIERS[t].adds.length ? TIERS[t].adds.map((f) => FEATURES[f]) : FREE_INCLUDES,
      selfServe: TIERS[t].checkout,
      get: howToGet(t),
      perSeat: perSeat(t),
      prices: prices.filter((p) => p.tier === t),
    })),
    subscription: sub
      ? {
          status: sub.status,
          interval: sub.interval,
          seats: sub.seats,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          paymentFailed: Boolean(sub.paymentFailedAt),
          hasCustomer: Boolean(sub.stripeCustomerId),
        }
      : null,
    invoices,
    seatsInUse: members.length + pending.length,
  };
}
