import { connection } from "next/server";

import { countVotes } from "@/lib/server/votes";
import { applied } from "@/lib/white-label/brand";
import { escapeHtml, widgetResponse } from "@/lib/white-label/embed";
import { brandByPublicId, brandForWorkspace, publicPlanOnly } from "@/lib/workspace/session";

type Ctx = { params: Promise<{ id: string }> };

/** The widget's only script, fixed so its CSP hash never changes: the plan id comes from a data attribute. */
const SCRIPT = `(function(){var run=document.body.getAttribute("data-run");function paint(c){document.querySelectorAll("[data-count]").forEach(function(e){e.textContent=String((c&&c[e.getAttribute("data-count")])||0)})}document.querySelectorAll("button[data-option]").forEach(function(b){b.addEventListener("click",function(){var o=b.getAttribute("data-option");fetch("/api/votes",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({runId:run,question:"city",option:o})}).then(function(r){return r.ok?r.json():null}).then(function(s){if(!s)return;paint(s.city&&s.city.counts);document.querySelectorAll("button[data-option]").forEach(function(x){x.setAttribute("aria-pressed",String(x===b))})})})})})();`;

/**
 * GET /embed/vote/{planId}[?w=<widget id>] → "Which city should we play?" for a publicly shared
 * plan, to embed in an iframe. Private plans are never shown, whoever is signed in. Votes go to the
 * same per-visitor vote store as the plan page.
 */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  await connection();
  const { id } = await params;
  const access = await publicPlanOnly(id);
  if (!access) return widgetResponse({ title: "Vote not found", body: "<p>This vote is not public.</p>", status: 404 });
  const w = new URL(req.url).searchParams.get("w") ?? "";
  const workspaceId = access.kind === "public" ? access.workspaceId : null;
  const owner = w ? await brandByPublicId(w) : workspaceId ? await brandForWorkspace(workspaceId) : null;
  // A widget id only brands its own workspace's plans.
  if (w && (!owner || owner.workspaceId !== workspaceId)) return widgetResponse({ title: "Vote not found", body: "<p>This widget is not set up for this plan.</p>", status: 404 });
  const look = applied(owner);
  const plan = access.plan;
  const options = (plan.city?.table ?? []).slice(0, 5).map((t) => t.pick.city);
  if (!options.length) return widgetResponse({ title: "Vote", body: "<p>This plan has no cities to vote on.</p>", status: 404, ...look });
  const counts = await countVotes(id, "city");
  const body = [
    `<h1>Where should ${escapeHtml(plan.fanbase?.name ?? plan.query)} play?</h1>`,
    `<p class="mute">Cities ranked from Qloo taste data. One vote each; you can change it.</p>`,
    ...options.map((c) => `<div class="row"><button type="button" data-option="${escapeHtml(c.id)}" aria-pressed="false">${escapeHtml(c.name)}</button><span><span data-count="${escapeHtml(c.id)}">${counts[c.id] ?? 0}</span> votes</span></div>`),
  ].join("");
  return widgetResponse({ title: "City vote", body, script: SCRIPT, bodyAttrs: { run: id }, ...look });
}
