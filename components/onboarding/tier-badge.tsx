import { TIERS, type TierName } from "@/lib/entitlements";

import { cx } from "../ui";

/** The tier a feature comes with (design: Free outline, Pro soft lime, Team soft lime with olive border, Enterprise ink outline). */
const TIER_CLS: Record<TierName, string> = {
  free: "border-line text-mute",
  pro: "border-acc-soft bg-acc-soft text-acc-text",
  team: "border-acc-line bg-acc-soft text-acc-text",
  enterprise: "border-ink text-ink",
};

export const TierBadge = ({ tier }: { tier: TierName }) => (
  <span data-tier-badge={tier} className={cx("whitespace-nowrap rounded-badge border px-1.5 py-px font-mono text-label uppercase tracking-[0.06em]", TIER_CLS[tier])}>
    {TIERS[tier].label}
  </span>
);
