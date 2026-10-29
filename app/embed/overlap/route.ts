import { connection } from "next/server";

import { withBudget } from "@/lib/agent/budget";
import { getQlooSource } from "@/lib/qloo/source";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";
import { checkOverlap } from "@/lib/tools/overlap";
import { applied } from "@/lib/white-label/brand";
import { escapeHtml, widgetResponse } from "@/lib/white-label/embed";
import { brandByPublicId } from "@/lib/workspace/session";

export const maxDuration = 30;

const LEVEL: Record<string, string> = { strong: "Strong overlap", clear: "Clear overlap", some: "Some overlap", unknown: "Overlap not measured" };

/**
 * GET /embed/overlap?a=&b=[&w=<widget id>] → a fan overlap card to embed in an iframe. With a
 * workspace's widget id it uses that workspace's Qloo allowance, branding and allowed sites;
 * without, Takeover's look and the per-visitor limit. No cookies are read or set.
 */
export async function GET(req: Request): Promise<Response> {
  await connection();
  const url = new URL(req.url);
  const a = (url.searchParams.get("a") ?? "").trim().slice(0, 100);
  const b = (url.searchParams.get("b") ?? "").trim().slice(0, 100);
  const w = url.searchParams.get("w") ?? "";
  const owner = w ? await brandByPublicId(w) : null;
  if (w && !owner) return widgetResponse({ title: "Widget not found", body: "<p>This widget is not set up.</p>", status: 404 });
  const look = applied(owner);
  if (!a || !b) return widgetResponse({ title: "Fan overlap", body: "<p>Give two names: ?a=…&amp;b=…</p>", status: 400, ...look });
  if (!owner && !isE2eRequest(req.headers)) {
    const limit = await getLimiters().tools.check(visitorId(req.headers));
    if (!limit.ok) return widgetResponse({ title: "Fan overlap", body: "<p>Too many lookups this hour. Try again later.</p>", status: 429, ...look });
  }
  const runId = `embed-${crypto.randomUUID()}`;
  const source = withBudget(getQlooSource(), runId, 8);
  const r = await checkOverlap(a, b, {}, source, { runId, ...(owner ? { scope: { kind: "workspace" as const, workspaceId: owner.workspaceId } } : {}) }).catch(() => null);
  if (!r) return widgetResponse({ title: "Fan overlap", body: "<p>Qloo didn't answer. Try again.</p>", status: 502, ...look });
  if (r.status !== "done") return widgetResponse({ title: "Fan overlap", body: `<p>No single match for “${escapeHtml(r.query)}”. Try a fuller name.</p>`, status: 404, ...look });
  const pct = (x: number | null) => (x === null ? null : Math.round(x * 100));
  const line = (who: string, of: string, v: number | null) =>
    v === null ? `<p class="mute">Qloo has no affinity for ${escapeHtml(of)} among ${escapeHtml(who)} fans.</p>` : `<p>${escapeHtml(who)} fans over-index on ${escapeHtml(of)}: <strong>${(v).toFixed(2)}</strong></p><progress max="100" value="${pct(v)}"></progress>`;
  const body = [
    `<h1>${escapeHtml(r.a.name)} × ${escapeHtml(r.b.name)}</h1>`,
    `<p class="mute">${LEVEL[r.level] ?? ""} · Qloo affinity, 0–1</p>`,
    line(r.a.name, r.b.name, r.bAmongA),
    line(r.b.name, r.a.name, r.aAmongB),
    r.cities.length ? `<p class="mute gap">Where both are strong</p>${r.cities.slice(0, 3).map((c) => `<div class="row"><span>${escapeHtml(c.city.name)}</span><span>${Math.round(c.combined * 100)} / 100</span></div>`).join("")}` : "",
  ].join("");
  return widgetResponse({ title: `${r.a.name} × ${r.b.name}`, body, ...look });
}
