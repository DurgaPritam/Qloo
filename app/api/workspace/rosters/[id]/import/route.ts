import { needFeature, withinLimit } from "@/lib/workspace/gate";
import { workspaceUsage } from "@/lib/qloo/allowance";
import { getQlooSource } from "@/lib/qloo/source";
import { MAX_IMPORT_ROWS, type CsvAct } from "@/lib/roster/csv";
import { resolveImport } from "@/lib/roster/resolve";
import { qlooReady } from "@/lib/roster/service";
import { can, ForbiddenError } from "@/lib/workspace/permissions";
import { inRoster, readJson } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * POST {rows: [{row, name, qlooId?, homeCity?}]} (parsed in the browser from the CSV) → resolves
 * each name with one Qloo search, adds the ones that resolve, and returns the rest for matching
 * by hand. Refused up front when the searches would not fit the workspace's allowance.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = await readJson(req);
  const rows: CsvAct[] = (Array.isArray(body.rows) ? body.rows : [])
    .slice(0, MAX_IMPORT_ROWS)
    .map((r: Record<string, unknown>, i: number) => ({
      row: Number.isInteger(r?.row) ? Number(r.row) : i + 1,
      name: str(r?.name, 100),
      qlooId: str(r?.qlooId, 200) || undefined,
      homeCity: str(r?.homeCity, 80) || undefined,
    }))
    .filter((r: CsvAct) => r.name);
  if (!rows.length) return Response.json({ error: "No act names to import." }, { status: 400 });
  return inRoster(id, async ({ repo, ctx }) => {
    const plan = await needFeature(repo, "rosters");
    const have = (await repo.rosters.acts(id)).length;
    withinLimit(plan, "rosterActs", have + rows.length - 1, `This plan's rosters hold up to ${plan.limits.rosterActs} acts; this one has ${have}, and the file has ${rows.length}.`);
    if (!can(ctx.role, "roster.edit")) throw new ForbiddenError("roster.edit");
    const source = getQlooSource();
    if (!qlooReady(source)) return Response.json({ error: "Qloo data is unavailable right now." }, { status: 503 });
    const usage = await workspaceUsage(ctx.workspaceId);
    if (rows.length > usage.remaining) {
      return Response.json(
        { error: `Matching ${rows.length} names can use up to ${rows.length} Qloo searches, and the workspace has ${usage.remaining} of ${usage.allowance} left this month.` },
        { status: 429 },
      );
    }
    const { resolved, unresolved } = await resolveImport(rows, source, { kind: "workspace", workspaceId: ctx.workspaceId });
    const { added, already } = await repo.rosters.addActs(id, resolved.map((r) => ({ entity: r.entity, homeCity: r.homeCity })), "csv");
    return Response.json({ added: added.length, already, unresolved });
  });
}
