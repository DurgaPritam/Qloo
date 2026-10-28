import { strFromU8, unzipSync } from "fflate";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildDeck } from "@/components/run/exports";
import type { DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { TENANT_TABLES } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { brandingFrom, contrastRatio, DEFAULT_BRANDING, logoProblem, mix, type DeckBranding } from "@/lib/export/branding";
import { ForbiddenError } from "@/lib/workspace/permissions";

import { addUser, testDb } from "../support/db";
import { openPptx } from "../support/pptx";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

let db: DB;
let queries: LoggedQuery[];

/** A real 1×1 PNG. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function person(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  return { user, workspaceId, repo: forWorkspace(db, { userId: user.id, workspaceId, role: "owner" }) };
}

beforeAll(async () => {
  ({ db, queries } = await testDb());
});
beforeEach(() => {
  queries.length = 0;
});

describe("branding rules", () => {
  it("checks contrast, logos and blends", () => {
    expect(contrastRatio("#161826", "#e9e9ed")).toBeGreaterThan(14);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(logoProblem(PNG)).toBeNull();
    expect(logoProblem("data:image/svg+xml;base64,PHN2Zz4=")).toMatch(/PNG or JPEG/);
    expect(logoProblem(`data:image/png;base64,${"A".repeat(500_000)}`)).toMatch(/over 300 KB/);
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(brandingFrom(null, "North Star")).toEqual({ ...DEFAULT_BRANDING, name: "North Star" });
  });
});

describe("workspace branding", () => {
  it("is saved by admins, read by every member, kept inside its workspace, and reset to the house deck", async () => {
    const a = await person("ana@brand.test");
    const b = await person("bo@brand.test");
    queries.length = 0;
    await a.repo.branding.save({ bg: "#ffffff", text: "#101010", accent: "#ff5500", font: "georgia", logo: { dataUrl: PNG, width: 1, height: 1 } });
    expect(brandingFrom(await a.repo.branding.get(), "A")).toMatchObject({ bg: "#ffffff", font: "georgia", logo: { width: 1 } });
    expect(await b.repo.branding.get()).toBeNull();
    await b.repo.branding.reset();
    expect(await a.repo.branding.get()).not.toBeNull();
    expectAllScoped(queries, TENANT_TABLES);
    await a.repo.branding.reset();
    expect(await a.repo.branding.get()).toBeNull();
  });

  it("can be changed only by admins and owners", async () => {
    const owner = await person("cy@brand.test");
    const member = await addUser(db, "dee@brand.test");
    const { token } = await owner.repo.invitations.create(member.email, "member");
    await unscopedAcceptInvitation(db, token, member);
    const repo = forWorkspace(db, { userId: member.id, workspaceId: owner.workspaceId, role: "member" });
    await expect(repo.branding.save({ ...DEFAULT_BRANDING, logo: null })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await repo.branding.get()).toBeNull();
  });
});

describe("branded decks", () => {
  const slides = [{ title: "Ali Wong × Liquid Death", subtitle: "Sponsorship pitch" }, { title: "Why it fits", bullets: ["A reason."] }];
  const xmlOf = async (branding: DeckBranding | null) => {
    const pptx = await buildDeck(slides, { title: "T", footer: "F", mock: false, branding });
    const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
    const zip = unzipSync(bytes);
    return { zip, xml: strFromU8(zip["ppt/slides/slide1.xml"]), open: openPptx(bytes) };
  };

  it("uses the workspace's colours, font and logo on every slide", async () => {
    const { zip, xml, open } = await xmlOf({ bg: "#ffffff", text: "#101010", accent: "#ff5500", font: "georgia", logo: { dataUrl: PNG, width: 400, height: 100 }, name: "North Star" });
    expect(xml).toContain('<a:srgbClr val="FFFFFF"/>');
    expect(xml).toContain('typeface="Georgia"');
    expect(xml).toContain('val="101010"');
    expect(Object.keys(zip).some((f) => /^ppt\/media\/image.*\.png$/.test(f))).toBe(true);
    // Georgia keeps the title's case; the logo replaces the Takeover wordmark.
    expect(open.slides[0].join(" ")).toContain("Ali Wong × Liquid Death");
    expect(open.slides[0].join(" ")).not.toContain("TAKEOVER");
  });

  it("shows the workspace's name when it has no logo, and the house deck when it has no settings", async () => {
    const named = await xmlOf({ ...DEFAULT_BRANDING, bg: "#202020", name: "North Star" });
    expect(named.open.slides[0]).toContain("NORTH STAR");
    expect(named.xml).toContain('typeface="Impact"');
    const house = await xmlOf(null);
    expect(house.xml).toContain('<a:srgbClr val="161826"/>');
    expect(house.open.slides[0]).toContain("TAKEOVER");
    expect(house.xml).toContain('typeface="Arial Black"');
  });
});
