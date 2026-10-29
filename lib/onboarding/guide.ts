import "server-only";

import { has, TIERS } from "@/lib/entitlements";
import { moreOf, REGISTRY, tierOf, type RoleKey } from "@/lib/features";
import type { TierName } from "@/lib/entitlements";

import type { ResolvedExample } from "./examples";

export interface GuideRow {
  id: string;
  name: string;
  benefit: string;
  numbers: string;
  roles: RoleKey[];
  tier: TierName;
  route: string;
  example: ResolvedExample | null;
  /** What this visitor needs to use it, and where to get it: never a dead end. */
  access: { text: string; href: string; label: string };
}

/** /guide's rows for a visitor: signed out (tier null) or signed in on a tier. */
export function guideRows(examples: Record<string, ResolvedExample>, visitor: { tier: string } | null): GuideRow[] {
  return REGISTRY.map((f) => {
    const tier = tierOf(f);
    const more = moreOf(f);
    const signIn = `/signin?next=${encodeURIComponent(f.route)}`;
    let access: GuideRow["access"];
    if (!visitor) {
      access = !f.account
        ? { text: more ? `Free, no account needed. ${more}.` : "Free, no account needed.", href: f.route, label: `Open ${f.name}` }
        : !f.entitlement
          ? { text: "Free with an account.", href: signIn, label: "Sign in to use it" }
          : { text: `Needs an account on ${TIERS[tier].label} or above.`, href: signIn, label: "Sign in to see it" };
    } else if (!f.entitlement || has(visitor.tier, f.entitlement)) {
      access = { text: more && !has(visitor.tier, f.more!) ? `In your plan. ${more}.` : "In your plan.", href: f.route, label: `Open ${f.name}` };
    } else {
      access = {
        text: `Comes with ${TIERS[tier].label}; what you already saved stays readable.`,
        href: TIERS[tier].checkout ? `/workspace/settings/billing?tier=${tier}` : "/workspace/settings/billing#contact",
        label: TIERS[tier].checkout ? `See ${TIERS[tier].label}` : "Talk to us",
      };
    }
    return { id: f.id, name: f.name, benefit: f.benefit, numbers: f.numbers, roles: f.roles, tier, route: f.route, example: examples[f.id] ?? null, access };
  });
}
