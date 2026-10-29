import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { useTier } from "./tier";

/** Branded decks: an admin sets colours and a font; the workspace's next deck uses them. */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `bea.${run}@e2e.test`;

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

test("set the deck branding, and a pitch deck comes out in it", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, EMAIL);
  await useTier(page, "enterprise");
  await page.goto("/workspace/settings");
  await page.getByRole("link", { name: "Branded decks →" }).click();
  await expect(page.getByRole("heading", { name: "Branded decks" })).toBeVisible();

  await page.getByLabel("Background hex").fill("#ffffff");
  await page.getByLabel("Text hex").fill("#ffff00");
  await expect(page.locator("[data-contrast]")).toContainText(/Use at least 4\.5:1/);
  await page.getByLabel("Text hex").fill("#101010");
  await expect(page.locator("[data-contrast]")).toContainText(/passes AA/);
  await page.getByLabel("Headline font").selectOption("georgia");
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByText("Saved. Every deck this workspace exports now uses it.")).toBeVisible();

  await page.goto("/workspace/sponsorship");
  await page.getByRole("textbox", { name: "Brand" }).fill("Liquid Death");
  await page.getByRole("button", { name: "Find talent" }).click();
  const download = page.waitForEvent("download");
  await page.locator("[data-match]").first().getByRole("button", { name: "Make pitch deck" }).click();
  const zip = unzipSync(new Uint8Array(readFileSync((await (await download).path())!)));
  const slide = strFromU8(zip["ppt/slides/slide1.xml"]);
  expect(slide).toContain('<a:srgbClr val="FFFFFF"/>');
  expect(slide).toContain('typeface="Georgia"');
  expect(slide).not.toContain(">TAKEOVER<");
});
