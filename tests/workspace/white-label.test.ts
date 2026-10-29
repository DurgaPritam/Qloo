import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as overlapWidget } from "@/app/embed/overlap/route";
import { GET as voteWidget } from "@/app/embed/vote/[id]/route";
import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Plan } from "@/lib/agent/types";
import { ATTRIBUTION } from "@/lib/api/attribution";
import { getDb, type DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { workspaces } from "@/lib/db/schema";
import { unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { contrastRatio } from "@/lib/export/branding";
import { MockQlooSource } from "@/lib/qloo/mock";
import { normaliseDomain, normaliseOrigins, verifyDomain } from "@/lib/white-label/domain";
import { cspFor, widgetResponse } from "@/lib/white-label/embed";
import { allowedOnCustomDomain, isPrimaryHost } from "@/lib/white-label/hosts";
import { brandVars } from "@/lib/white-label/theme";
import { brandByDomain, brandByPublicId } from "@/lib/workspace/session";
import { proxy } from "@/proxy";

import { addUser } from "../support/db";

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

let db: DB;
let template: Plan;

async function workspace(email: string, tier: "free" | "pro" = "pro") {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  await db.update(workspaces).set({ tier }).where(eq(workspaces.id, workspaceId));
  const repo = forWorkspace(db, { userId: user.id, workspaceId, role: "owner" });
  return { user, workspaceId, repo };
}
async function planIn(repo: ReturnType<typeof forWorkspace>, visibility: "public" | "workspace") {
  const id = crypto.randomUUID();
  await repo.plans.create({ id, query: "Phoebe Bridgers", result: { ...template, runId: id } });
  if (visibility === "public") await repo.plans.setVisibility(id, "public");
  return id;
}
const sha = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
const widget = (res: Response) => res.text().then((html) => ({ html, csp: res.headers.get("content-security-policy") ?? "" }));

beforeAll(async () => {
  db = await getDb();
  template = await runAgent({ query: "Phoebe Bridgers" }, { runId: "t", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
});
beforeEach(() => {
  vi.stubEnv("TAKEOVER_MOCK", "1");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("custom domains", () => {
  it("accept a domain the workspace owns, never Takeover's own, and verify it by its TXT record", async () => {
    expect(normaliseDomain("https://Plans.NorthStar.live/")).toEqual({ domain: "plans.northstar.live" });
    expect(normaliseDomain("not a domain")).toHaveProperty("error");
    expect(normaliseDomain("takeover-x.vercel.app")).toHaveProperty("error");
    const records: Record<string, string[][]> = { "_takeover.plans.northstar.live": [["takeover-verify=abc"]] };
    const resolve = async (name: string) => records[name] ?? Promise.reject(new Error("ENOTFOUND"));
    expect(await verifyDomain("plans.northstar.live", "abc", resolve)).toBe(true);
    expect(await verifyDomain("plans.northstar.live", "xyz", resolve)).toBe(false);
    expect(await verifyDomain("other.live", "abc", resolve)).toBe(false);
    expect(normaliseOrigins("https://a.com\nhttps://a.com/page http://localhost:3000")).toEqual({ origins: ["https://a.com", "http://localhost:3000"] });
    expect(normaliseOrigins("http://insecure.com")).toHaveProperty("error");
  });

  it("serve only shared plans and widgets: the proxy turns everything else away on a custom domain", () => {
    expect(isPrimaryHost("localhost:3000")).toBe(true);
    expect(isPrimaryHost("takeover-abc.vercel.app")).toBe(true);
    expect(isPrimaryHost("plans.northstar.live")).toBe(false);
    for (const p of [`/p/${crypto.randomUUID()}`, "/embed/overlap", "/_next/static/x.js"]) expect(allowedOnCustomDomain(p), p).toBe(true);
    for (const p of ["/workspace", "/signin", "/api/v1/overlap", "/plan/x", "/dev/outbox"]) expect(allowedOnCustomDomain(p), p).toBe(false);
    const on = (host: string, path: string) => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
    expect(on("plans.northstar.live", "/workspace").status).toBe(404);
    expect(on("plans.northstar.live", "/api/workspace/api-keys").status).toBe(404);
    expect(on("plans.northstar.live", "/embed/overlap").status).toBe(200);
    expect(on("localhost:3000", "/workspace").status).toBe(200);
  });

  it("only a verified domain resolves to its workspace, and a new domain starts unverified", async () => {
    const { repo, workspaceId } = await workspace("dom@wl.test");
    const row = await repo.whiteLabel.setDomain("plans.dom.test");
    expect(row.domainVerifiedAt).toBeNull();
    expect(row.domainToken).toBeTruthy();
    expect(await brandByDomain("plans.dom.test")).toBeNull();
    await repo.whiteLabel.markVerified(new Date());
    expect((await brandByDomain("plans.dom.test"))?.workspaceId).toBe(workspaceId);
    await repo.whiteLabel.setDomain("plans2.dom.test");
    expect(await brandByDomain("plans2.dom.test")).toBeNull();
    expect(await brandByDomain("plans.dom.test")).toBeNull();
  });
});

describe("brand colours", () => {
  it("keep accent text readable: it falls back to the text colour when the accent is too faint", () => {
    const v = brandVars({ bg: "#ffffff", text: "#111111", accent: "#ffee00" });
    expect(v["--acc-text"]).toBe("#111111");
    expect(contrastRatio(v["--on-acc"], "#ffee00")).toBeGreaterThan(4.5);
    expect(brandVars({ bg: "#ffffff", text: "#111111", accent: "#0044cc" })["--acc-text"]).toBe("#0044cc");
  });
});

describe("widget isolation", () => {
  it("each widget's CSP allows only its own hashed style and script, nothing remote, no forms, no plugins", async () => {
    const res = widgetResponse({ title: "T", body: "<p>x</p>", script: "console.log(1)" });
    const { html, csp } = await widget(res);
    const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`style-src ${sha(style)}`);
    expect(csp).toContain(`script-src ${sha(script)}`);
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
    expect(html).not.toMatch(/ style="/); // style attributes would be blocked
    expect(cspFor("a", null, [])).toContain("script-src 'none'");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a city vote shows only public plans, ignores whoever is signed in, and carries the attribution", async () => {
    const { repo } = await workspace("vote@wl.test");
    const priv = await planIn(repo, "workspace");
    const pub = await planIn(repo, "public");
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await voteWidget(new Request(`http://localhost/embed/vote/${priv}`), ctx(priv))).status).toBe(404);
    const res = await voteWidget(new Request(`http://localhost/embed/vote/${pub}`), ctx(pub));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const { html, csp } = await widget(res);
    expect(html).toContain(`data-run="${pub}"`);
    expect(html).toContain(`href="${ATTRIBUTION.url}"`);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors *");
  });

  it("a widget id brands only its own workspace's plans, and the allowed sites become frame-ancestors", async () => {
    const a = await workspace("wa@wl.test");
    const b = await workspace("wb@wl.test");
    const wa = await a.repo.whiteLabel.ensure();
    await a.repo.whiteLabel.setEmbedOrigins(["https://www.a-company.test"]);
    await a.repo.branding.save({ bg: "#ffffff", text: "#101010", accent: "#0044cc", font: "inter", logo: null });
    const planA = await planIn(a.repo, "public");
    const planB = await planIn(b.repo, "public");
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await voteWidget(new Request(`http://localhost/embed/vote/${planB}?w=${wa.publicId}`), ctx(planB))).status).toBe(404);
    const { html, csp } = await widget(await voteWidget(new Request(`http://localhost/embed/vote/${planA}?w=${wa.publicId}`), ctx(planA)));
    expect(csp).toContain("frame-ancestors https://www.a-company.test");
    expect(html).toContain("--bg:#ffffff"); // Pro tier: the workspace's colours
    expect((await brandByPublicId(wa.publicId))?.workspaceId).toBe(a.workspaceId);

    // On the free tier the widget keeps Takeover's look, but still only frames on the allowed sites.
    await db.update(workspaces).set({ tier: "free" }).where(eq(workspaces.id, a.workspaceId));
    const free = await widget(await voteWidget(new Request(`http://localhost/embed/vote/${planA}?w=${wa.publicId}`), ctx(planA)));
    expect(free.html).not.toContain("--bg:#ffffff");
    expect(free.csp).toContain("frame-ancestors https://www.a-company.test");
  });

  it("the overlap widget answers with Qloo's figures, no script, and refuses unknown widget ids", async () => {
    const res = await overlapWidget(new Request("http://localhost/embed/overlap?a=Phoebe%20Bridgers&b=PEN15", { headers: { "x-forwarded-for": "198.51.100.7" } }));
    expect(res.status).toBe(200);
    const { html, csp } = await widget(res);
    expect(html).toMatch(/fans over-index on/);
    expect(html).toContain("data-attribution");
    expect(csp).toContain("script-src 'none'");
    expect((await overlapWidget(new Request("http://localhost/embed/overlap?a=x&b=y&w=w_doesnotexist1"))).status).toBe(404);
  });
});
