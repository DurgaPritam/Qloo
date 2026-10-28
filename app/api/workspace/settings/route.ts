import { InputError } from "@/lib/db/scoped";
import { isTimeZone } from "@/lib/watch/schedule";
import { CURRENCIES } from "@/lib/workspace/currency";
import { inWorkspace, readJson } from "@/lib/workspace/route";

/**
 * POST {name} → renames the current workspace (owners only).
 * POST {timeZone, currency, outcomeMinSample} → the workspace's settings (admins); null clears one.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    if (typeof body.name === "string") {
      await repo.workspace.rename(body.name);
      return Response.json({ ok: true });
    }
    const tz = typeof body.timeZone === "string" && body.timeZone ? body.timeZone : null;
    if (tz && !isTimeZone(tz)) throw new InputError("Pick a time zone from the list.");
    const currency = typeof body.currency === "string" && body.currency ? body.currency : null;
    if (currency && !CURRENCIES.includes(currency)) throw new InputError("Pick a currency from the list.");
    const raw = body.outcomeMinSample;
    const min = raw === null || raw === "" || raw === undefined ? null : Number(raw);
    if (min !== null && !(Number.isInteger(min) && min >= 2 && min <= 50)) throw new InputError("The minimum sample must be a whole number from 2 to 50.");
    await repo.workspace.saveSettings({ timeZone: tz, currency, outcomeMinSample: min });
    return Response.json({ ok: true });
  });
}
