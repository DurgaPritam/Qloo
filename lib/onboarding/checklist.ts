import "server-only";

import type { WorkspaceRepo } from "@/lib/db/scoped";
import { CHECKLIST, tierOf, type ChecklistKey } from "@/lib/features";
import { has, TIERS, type TierName } from "@/lib/entitlements";
import { planOf } from "@/lib/workspace/gate";
import { can } from "@/lib/workspace/permissions";

export interface ChecklistRow {
  key: ChecklistKey;
  title: string;
  sub: string;
  cta: string;
  href: string;
  done: boolean;
  /** The tier that unlocks it when this workspace's plan doesn't, else null. */
  needs: { tier: TierName; label: string; selfServe: boolean } | null;
}

export interface ChecklistView {
  dismissed: boolean;
  canDismiss: boolean;
  rows: ChecklistRow[];
}

const none = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);

/**
 * The getting-started checklist, ticked from the workspace's own data (a saved plan, a roster, a
 * dataset, a watch, a second member or a pending invitation). Nothing is stored but the dismissal.
 */
export async function checklistView(repo: WorkspaceRepo): Promise<ChecklistView> {
  const role = repo.context.role;
  const [ws, plan, plans, rosters, datasets, watches, members, pending] = await Promise.all([
    repo.workspace.get(),
    planOf(repo),
    repo.plans.countSince(new Date(0)),
    none(repo.rosters.list()),
    none(repo.datasets.list()),
    none(repo.watch.items()),
    none(repo.members.list()),
    can(role, "member.invite") ? none(repo.invitations.listPending()) : Promise.resolve([]),
  ]);
  const done: Record<ChecklistKey, boolean> = {
    run: plans > 0,
    roster: rosters.length > 0,
    data: datasets.length > 0,
    watch: watches.length > 0,
    invite: members.length > 1 || pending.length > 0,
  };
  return {
    dismissed: Boolean(ws?.checklistDismissedAt),
    canDismiss: can(role, "checklist.dismiss"),
    rows: CHECKLIST.map((c) => {
      const t = tierOf(c.feature);
      const allowed = !c.feature.entitlement || has(plan.tier, c.feature.entitlement);
      return {
        key: c.key,
        title: c.title,
        sub: c.feature.benefit,
        cta: c.cta,
        href: c.feature.route,
        done: done[c.key],
        needs: allowed ? null : { tier: t, label: TIERS[t].label, selfServe: TIERS[t].checkout },
      };
    }),
  };
}
