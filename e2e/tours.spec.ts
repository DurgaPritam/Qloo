import { expect, test, type Page } from "@playwright/test";

import { useTier } from "./tier";

/** Saving a tour to the workspace: the route as optimized, plus the user's own date, reopened later. */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `tom.${run}@e2e.test`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await page.goto("/dev/outbox");
  const href = await page.locator(`[data-outbox-to="${email}"]`).first().locator("[data-outbox-link]").first().getAttribute("href");
  await page.goto(href!);
}

test("optimize a tour, set a date, save it to the workspace and reopen it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/tour?q=John%20Mulaney");
  await expect(page.getByRole("list", { name: "Stops" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Save to workspace" })).toHaveCount(0); // signed out: nothing to save to

  await signIn(page, EMAIL);

  await useTier(page, "enterprise");
  await page.goto("/tour?q=John%20Mulaney");
  const first = page.getByRole("list", { name: "Stops" }).locator("[data-stop]").first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  const city = await first.getAttribute("data-stop");
  await first.getByLabel(`Date in ${city}`).fill("2027-03-02");
  await page.getByRole("button", { name: "Save to workspace" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved to / })).toBeVisible();

  const saved = page.getByRole("list", { name: "Saved tours" }).getByRole("link").first();
  await expect(saved).toContainText("John Mulaney");
  await page.goto((await saved.getAttribute("href"))!);
  await expect(page.getByText(/^Saved tour · John Mulaney/)).toBeVisible();
  const reopened = page.getByRole("list", { name: "Stops" }).locator(`[data-stop="${city}"]`);
  await expect(reopened.getByLabel(`Date in ${city}`)).toHaveValue("2027-03-02");
});
