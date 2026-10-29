import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { openPptx } from "../tests/support/pptx";

import { useTier } from "./tier";

/** Sponsorship: brand view, save to the shortlist, a pitch deck, then the rights-holder view. */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `sol.${run}@e2e.test`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await page.goto("/dev/outbox");
  const href = await page.locator(`[data-outbox-to="${email}"]`).first().locator("[data-outbox-link]").first().getAttribute("href");
  await page.goto(href!);
  await expect(page).toHaveURL(/\/workspace/);
}

test("brand view, shortlist, pitch deck and rights-holder view", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, EMAIL);
  await useTier(page, "enterprise");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Sponsorship" }).click();
  await expect(page.getByRole("heading", { name: "Brand view" })).toBeVisible();

  let first = "";
  await test.step("brand view: talent and teams that fit, with Qloo evidence both ways", async () => {
    await page.getByRole("textbox", { name: "Brand" }).fill("Liquid Death");
    await expect(page.getByText(/Uses up to 17 Qloo calls/)).toBeVisible();
    await page.getByRole("button", { name: "Find talent" }).click();
    const cards = page.locator("[data-match]");
    await expect(cards.first()).toBeVisible();
    first = (await cards.first().getAttribute("data-match"))!;
    const card = cards.first();
    await expect(card.getByRole("meter")).toBeVisible();
    await expect(card.getByText(/fans over-index on Liquid Death: Qloo affinity \d\.\d\d\./)).toBeVisible();
    await expect(card.getByText(/Liquid Death fans over-index on .*: Qloo affinity \d\.\d\d\./)).toBeVisible();
    await expect(card.getByText(/Reach, impressions, fees and availability: to confirm/)).toBeVisible();
  });

  await test.step("save to the shortlist and make a pitch deck", async () => {
    const card = page.locator(`[data-match="${first}"]`);
    await card.getByRole("button", { name: "Save to shortlist" }).click();
    await expect(card.getByRole("button", { name: "On the shortlist" })).toBeVisible();
    await expect(page.locator(`[data-shortlist="${first} × Liquid Death"]`)).toBeVisible();
    const download = page.waitForEvent("download");
    await card.getByRole("button", { name: "Make pitch deck" }).click();
    expect((await download).suggestedFilename()).toMatch(/liquid-death-pitch-sample\.pptx$/);
  });

  await test.step("a team: brands to pitch, ranked and evidenced, and its pitch deck opens", async () => {
    await page.getByRole("tab", { name: "Rights-holder view" }).click();
    await page.getByRole("textbox", { name: "Act or team" }).fill("Golden State Warriors");
    await page.getByRole("button", { name: "Find brands" }).click();
    const card = page.locator("[data-match]").first();
    await expect(card).toBeVisible();
    await expect(page.getByText(/^Golden State Warriors$/).first()).toBeVisible();
    await expect(card.getByText(/Golden State Warriors fans over-index on .*: Qloo affinity \d\.\d\d\./)).toBeVisible();
    await card.getByText("Where each figure comes from").click();
    await expect(card.getByText(/fit, forward/)).toBeVisible();
    await expect(card.getByText(/GET \/v2\/insights · filter\.type=urn:entity:brand/).first()).toBeVisible();
    const download = page.waitForEvent("download");
    await card.getByRole("button", { name: "Make pitch deck" }).click();
    const file = await (await download).path();
    const { slides } = openPptx(new Uint8Array(readFileSync(file!)));
    expect(slides.length).toBeGreaterThanOrEqual(4);
    expect(slides[0].join(" ")).toMatch(/GOLDEN STATE WARRIORS ×/);
    expect(slides.at(-1)!.join(" ")).toContain("SOURCES");
    await page.getByRole("tab", { name: "Brand view" }).click();
  });

  await test.step("rights-holder view: brands to pitch, grouped by sector", async () => {
    await page.getByRole("tab", { name: "Rights-holder view" }).click();
    await expect(page.getByRole("heading", { name: "Rights-holder view" })).toBeVisible();
    await page.getByRole("textbox", { name: "Act or team" }).fill("Phoebe Bridgers");
    await page.getByRole("button", { name: "Find brands" }).click();
    await expect(page.locator("[data-match]").first()).toBeVisible();
    await expect(page.getByText(/Phoebe Bridgers fans over-index on .*: Qloo affinity/).first()).toBeVisible();
    // The shortlist persists across views and reloads.
    await page.reload();
    await expect(page.locator(`[data-shortlist="${first} × Liquid Death"]`)).toBeVisible();
  });

  await test.step("a shortlisted match goes to the outreach pipeline as a draft", async () => {
    const row = page.locator(`[data-shortlist="${first} × Liquid Death"]`);
    await row.getByRole("button", { name: "Send to pipeline" }).click();
    await expect(row.getByRole("status")).toContainText("Added the draft to the pipeline.");
    await page.goto("/workspace/pipeline");
    await expect(page.getByRole("region", { name: "Drafted" }).locator('[data-card="Liquid Death partnerships"]')).toBeVisible();
  });
});
