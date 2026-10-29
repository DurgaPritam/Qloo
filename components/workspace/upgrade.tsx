import Link from "next/link";

import type { Upgrade } from "@/lib/entitlements";

import { MonoLabel, Panel } from "../ui";

/** What the next tier unlocks, with the way to get it: never a dead end. */
export function UpgradePrompt({ upgrade, compact }: { upgrade: Upgrade; compact?: boolean }) {
  const href = upgrade.selfServe ? `/workspace/settings/billing?tier=${upgrade.tier}` : "/workspace/settings/billing#contact";
  return (
    <section aria-label="Upgrade" data-upgrade={upgrade.tier}>
      <Panel className="gap-2 border-th border-acc-line">
        <MonoLabel className="text-acc-text">{upgrade.label} unlocks</MonoLabel>
        <p className="m-0 text-body">{upgrade.reason}</p>
        {!compact && upgrade.unlocks.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-chip">
            {upgrade.unlocks.map((u) => (
              <li key={u} className="flex gap-2">
                <span className="text-acc-text">✓</span>
                {u}
              </li>
            ))}
          </ul>
        )}
        <span className="text-chip text-mute">What you already have stays readable whatever the plan.</span>
        <div>
          <Link href={href} className="inline-block rounded-btn bg-acc px-4 py-2 font-semibold text-on-acc no-underline hover:text-on-acc">
            {upgrade.selfServe ? `Upgrade to ${upgrade.label}` : `Talk to us about ${upgrade.label}`}
          </Link>
        </div>
      </Panel>
    </section>
  );
}
