import { connection } from "next/server";

import { dailyPuzzle, today } from "@/lib/server/daily";

/** GET → today's puzzle, without answers. POST {date, round, option} → whether it was right, and what Qloo said. */
export async function GET(): Promise<Response> {
  await connection();
  const { date, number } = today();
  const built = await dailyPuzzle(date, number);
  if (!built) return Response.json({ error: "Today's puzzle isn't ready yet. Try an example plan instead." }, { status: 503 });
  return Response.json(built.puzzle);
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { date?: unknown; round?: unknown; option?: unknown } | null;
  const { date, number } = today();
  if (body?.date !== date) return Response.json({ error: "A new puzzle is out. Reload the page." }, { status: 409 });
  const built = await dailyPuzzle(date, number);
  const round = Number(body?.round);
  if (!built || !Number.isInteger(round) || round < 0 || round >= built.answers.correct.length || typeof body?.option !== "string") {
    return Response.json({ error: "Unknown round." }, { status: 400 });
  }
  const last = round === built.answers.correct.length - 1;
  return Response.json({
    correct: built.answers.correct[round] === body.option,
    answer: built.answers.correct[round],
    reveal: built.answers.reveal[round],
    // The plan behind the puzzle is revealed only after the last round.
    query: last ? built.answers.query : undefined,
  });
}
