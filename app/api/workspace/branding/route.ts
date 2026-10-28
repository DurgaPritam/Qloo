import { InputError } from "@/lib/db/scoped";
import { brandingFrom, DECK_FONTS, isHex, logoProblem, normaliseHex, type DeckFont } from "@/lib/export/branding";
import { currentWorkspace } from "@/lib/workspace/session";
import { inWorkspace, readJson } from "@/lib/workspace/route";

/** GET → the deck branding for the current workspace (null when signed out: the house deck). */
export async function GET(): Promise<Response> {
  const found = await currentWorkspace().catch(() => null);
  if (!found) return Response.json({ branding: null });
  const name = found.memberships.find((m) => m.workspaceId === found.ctx.workspaceId)?.name ?? "";
  return Response.json({ branding: brandingFrom(await found.repo.branding.get(), name) });
}

/** POST {bg, text, accent, font, logo?: {dataUrl, width, height} | null} → saves (admins). */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    const [bg, text, accent] = [body.bg, body.text, body.accent].map((v) => (typeof v === "string" ? normaliseHex(v) : ""));
    if (![bg, text, accent].every(isHex)) throw new InputError("Colours must be hex values like #161826.");
    const font = (DECK_FONTS as readonly string[]).includes(String(body.font)) ? (body.font as DeckFont) : null;
    if (!font) throw new InputError("Pick Anton, Inter Bold or Georgia.");
    let logo: { dataUrl: string; width: number; height: number } | null = null;
    if (body.logo && typeof body.logo === "object") {
      const l = body.logo as Record<string, unknown>;
      const dataUrl = typeof l.dataUrl === "string" ? l.dataUrl : "";
      const problem = logoProblem(dataUrl);
      if (problem) throw new InputError(problem);
      const [w, h] = [Number(l.width), Number(l.height)];
      if (![w, h].every((x) => Number.isInteger(x) && x > 0 && x <= 10_000)) throw new InputError("The logo's size could not be read.");
      logo = { dataUrl, width: w, height: h };
    }
    await repo.branding.save({ bg, text, accent, font, logo });
    return Response.json({ ok: true });
  });
}

/** DELETE → back to Takeover's house deck (admins). */
export async function DELETE(): Promise<Response> {
  return inWorkspace(async ({ repo }) => {
    await repo.branding.reset();
    return Response.json({ ok: true });
  });
}
