import { expect, test } from "@playwright/test";

/**
 * Lineup optimizer: a pool typed and from a CSV, the user's tiers, budget and slots, Qloo's
 * pairwise affinities, the best bill with reasons and near misses, the trade-off slider, and the poster.
 */
test("build a pool, optimize the bill inside the budget, and save the poster", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/lineup");
  await expect(page.getByRole("heading", { name: "Lineup optimizer" })).toBeVisible();

  const box = page.getByRole("textbox", { name: "Add an act" });
  for (const name of ["John Mulaney", "Ali Wong"]) {
    await box.fill(name);
    await box.press("Enter");
  }
  await page.getByLabel("Acts CSV").setInputFiles({ name: "pool.csv", mimeType: "text/csv", buffer: Buffer.from("name,tier,must_include\nPhoebe Bridgers,A,yes\n") });
  const pool = page.getByRole("list", { name: "Pool" });
  await expect(pool.locator("[data-pool-act]")).toHaveCount(3);
  await expect(pool.getByLabel("Fee tier for Phoebe Bridgers")).toHaveValue("A");
  await page.getByLabel("Fee tier for John Mulaney").selectOption("B");

  await page.getByRole("button", { name: "Match and score the pool" }).click();
  await expect(page.getByLabel("Total budget")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Enter your budget and fee tiers to see the best bill.")).toBeVisible();
  await page.getByLabel("Total budget").fill("80000");
  await page.getByLabel("Tier A fee").fill("50000");
  await page.getByLabel("Tier B fee").fill("20000");
  await page.getByLabel("Tier C fee").fill("5000");

  const bill = page.getByRole("region", { name: "Suggested lineup" });
  await expect(bill.locator("[data-bill]").first()).toBeVisible();
  // The must-include act is on the bill, and every act says why.
  await expect(bill.locator('[data-bill="Phoebe Bridgers"]')).toBeVisible();
  await expect(bill.locator('[data-bill="Phoebe Bridgers"] [data-why]')).toContainText("Must include (yours).");
  await expect(bill.locator("[data-score]")).toContainText(/Score \d\.\d\d = 0\.70 × crowd fit \d\.\d\d \+ 0\.30 × coverage \d\.\d\d/);
  const before = await bill.locator("[data-score]").innerText();
  await page.getByLabel("Coverage weight").fill("100");
  await expect(bill.locator("[data-score]")).toContainText("0.00 × crowd fit");
  expect(await bill.locator("[data-score]").innerText()).not.toBe(before);

  // Too small a budget for the must-include act: the engine says so instead of suggesting a bill.
  await page.getByLabel("Total budget").fill("40000");
  await expect(page.getByRole("status").filter({ hasText: /must-include acts alone cost/ })).toBeVisible();
  await page.getByLabel("Total budget").fill("80000");

  await page.getByRole("textbox", { name: "Poster title" }).fill("Night One");
  await page.getByRole("button", { name: "Make the poster" }).click();
  await expect(page).toHaveURL(/\/lineup\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Night One" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Poster/ })).toBeVisible();
});
