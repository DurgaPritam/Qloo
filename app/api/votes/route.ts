import { connection } from "next/server";

import { loadPlan } from "@/lib/server/plan-store";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";
import { castVote, countVotes, myVote, VOTE_QUESTIONS, type VoteQuestion } from "@/lib/server/votes";

const ID = /^[0-9a-f-]{36}$/;

/** The options a plan offers: its shortlisted partners and its top cities. */
async function optionsFor(runId: string): Promise<Record<VoteQuestion, string[]> | null> {
  const plan = await loadPlan(runId);
  if (!plan) return null;
  return {
    partner: plan.partners?.picks.map((p) => p.pick.entity.id) ?? [],
    city: plan.city?.table.map((t) => t.pick.city.id) ?? [],
  };
}

async function state(runId: string, visitor: string) {
  const entries = await Promise.all(
    VOTE_QUESTIONS.map(async (q) => [q, { counts: await countVotes(runId, q), mine: await myVote(runId, q, visitor) }] as const),
  );
  return Object.fromEntries(entries);
}

/** GET ?runId= → vote counts per question and this visitor's own votes. */
export async function GET(req: Request): Promise<Response> {
  await connection();
  const runId = new URL(req.url).searchParams.get("runId") ?? "";
  if (!ID.test(runId)) return Response.json({ error: "Unknown plan." }, { status: 400 });
  return Response.json(await state(runId, visitorId(req.headers)));
}

/** POST {runId, question, option} → records or changes this visitor's vote. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { runId?: unknown; question?: unknown; option?: unknown } | null;
  const runId = typeof body?.runId === "string" && ID.test(body.runId) ? body.runId : "";
  const question = VOTE_QUESTIONS.find((q) => q === body?.question);
  const option = typeof body?.option === "string" ? body.option : "";
  if (!runId || !question || !option) return Response.json({ error: "Send runId, question and option." }, { status: 400 });

  const options = await optionsFor(runId);
  if (!options) return Response.json({ error: "This plan is no longer stored." }, { status: 404 });
  if (!options[question].includes(option)) return Response.json({ error: "That isn't one of this plan's options." }, { status: 400 });

  if (!isE2eRequest(req.headers)) {
    const limit = await getLimiters().tools.check(visitorId(req.headers));
    if (!limit.ok) return Response.json({ error: "Too many votes this hour. Try again later." }, { status: 429 });
  }
  const visitor = visitorId(req.headers);
  await castVote(runId, question, option, visitor);
  return Response.json(await state(runId, visitor));
}
