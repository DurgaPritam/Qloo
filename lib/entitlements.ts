/**
 * What each plan tier allows. Billing is not built yet (Prompt 12), so every workspace is on "free"
 * until it is, and these numbers are placeholders to confirm with the pricing.
 */
export const TIER_NAMES = ["free", "pro", "enterprise"] as const;
export type TierName = (typeof TIER_NAMES)[number];

export interface Entitlements {
  label: string;
  api: {
    /** Requests per minute, per key. */
    perMinute: number;
    /** Requests per calendar month (UTC), per key. */
    monthly: number;
    /** Keys a workspace may hold at once. */
    keys: number;
  };
  whiteLabel: boolean;
}

export const TIERS: Record<TierName, Entitlements> = {
  free: { label: "Free", api: { perMinute: 10, monthly: 500, keys: 2 }, whiteLabel: false },
  pro: { label: "Pro", api: { perMinute: 60, monthly: 10_000, keys: 10 }, whiteLabel: true },
  enterprise: { label: "Enterprise", api: { perMinute: 300, monthly: 100_000, keys: 50 }, whiteLabel: true },
};

export const PLACEHOLDER_NOTE = "Tier limits are placeholders to confirm with pricing.";

export const isTier = (x: unknown): x is TierName => typeof x === "string" && (TIER_NAMES as readonly string[]).includes(x);
export const entitlementsFor = (tier: string | null | undefined): Entitlements => TIERS[isTier(tier) ? tier : "free"];
