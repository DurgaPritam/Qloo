import "server-only";

import { withBudget } from "@/lib/agent/budget";
import type { WorkspaceRepo } from "@/lib/db/scoped";
import { InputError } from "@/lib/db/scoped";
import { MAX_OUTPUT_TOKENS } from "@/lib/llm";
import type { LLMProvider } from "@/lib/llm/types";
import type { QlooSource } from "@/lib/qloo/source";
import { audienceProfiles } from "@/lib/tools/audience";
import type { CallView } from "@/lib/tools/shared";
import { safeRephrase } from "@/lib/watch/wording";
import { can, ForbiddenError } from "@/lib/workspace/permissions";

import { buildBrief, type CampaignBriefData } from "./brief";

/** At most two demographics calls: the fanbase and the partner. */
export const BRIEF_CALLS = 2;
const WEEK_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Makes and saves a brief for one of the workspace's plans. Qloo is asked only for demographics
 * (the rest is the plan's own Qloo data); a city's note is a Market watch alert from the last week,
 * when the workspace watches the fanbase. The model may rephrase each angle's sentence; a
 * rephrasing that changes a name or a number is thrown away.
 */
export async function makeBrief(
  repo: WorkspaceRepo,
  input: { planId: string; title?: string | null; flight?: string | null; budget?: string | null },
  deps: { source: QlooSource; model: LLMProvider | null; now: Date },
): Promise<{ id: string; brief: CampaignBriefData }> {
  // Checked first, so a role that cannot save a brief spends no Qloo calls.
  if (!can(repo.context.role, "plan.create")) throw new ForbiddenError("plan.create");
  const row = await repo.plans.get(input.planId);
  const plan = row?.result;
  if (!plan) throw new InputError("That plan isn't in this workspace.");
  if (plan.status !== "complete" || !plan.fanbase) throw new InputError("Pick a finished plan: this one stopped before its city step.");
  const partner = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick.entity ?? null;

  const runId = `brief-${crypto.randomUUID()}`;
  const budgeted = withBudget(deps.source, runId, BRIEF_CALLS);
  const calls: CallView[] = [];
  const opts = { runId, scope: { kind: "workspace" as const, workspaceId: repo.context.workspaceId } };
  const people = [plan.fanbase, ...(partner ? [partner] : [])];
  const profiles = await audienceProfiles(
    people.map((p) => p.id),
    budgeted,
    opts,
    calls,
  );
  const audience = profiles.map((p) => ({ ...p.summary, of: people.find((x) => x.id === p.entityId)?.name ?? "" }));

  const cityIds = new Set((plan.city?.table ?? []).map((t) => t.pick.city.id));
  const cityNotes: Record<string, string> = {};
  if (can(repo.context.role, "watch.read")) {
    for (const a of await repo.watch.alerts({ since: new Date(deps.now.getTime() - WEEK_MS), limit: 100 })) {
      if (cityIds.has(a.entityId) && !cityNotes[a.entityId]) cityNotes[a.entityId] = `This week: ${a.title}`;
    }
  }

  const brief = buildBrief(plan, { planId: input.planId, title: input.title, flight: input.flight, budget: input.budget, audience, cityNotes, now: deps.now });
  brief.sources = calls.map((c, i) => ({ figure: `Audience: ${people[i]?.name ?? "fans"}`, endpoint: c.endpoint, params: c.params }));
  if (deps.model) {
    const names = [brief.fanbase, brief.partner, brief.city, ...brief.interests.map((i) => i.name), ...brief.cities.map((c) => c.name)].filter((n): n is string => Boolean(n));
    for (const a of brief.angles) {
      try {
        const res = await deps.model.complete(
          `Rewrite this creative idea for an event campaign brief in one lively sentence. Keep every name exactly as written, add no numbers, dates, prices or capacities, and reply with the sentence only.\n\n${a.body}`,
          { maxOutputTokens: Math.min(200, MAX_OUTPUT_TOKENS.completion) },
        );
        if (!res.refused) a.body = safeRephrase(a.body, res.text, names);
      } catch {
        // The template stands.
      }
    }
  }
  const id = await repo.briefs.save(input.planId, brief);
  return { id, brief };
}
