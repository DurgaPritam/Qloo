import { expect, test, type Page } from "@playwright/test";

/**
 * Roster intelligence, signed in through the local outbox: create a roster, add five acts (one
 * through the picker for an ambiguous name), see the budget before refreshing, see the
 * pairings, and open a pair as a plan.
 */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `rosa.${run}@e2e.test`;
/** Nine by name (unique per run, so nothing is cached yet) and one through the picker: ten acts. */
const ACTS = ["Ali Wong", "Hasan Minhaj", "Taylor Tomlinson", "Atsuko Okatsuka", "Nate Bargatze", "Alex Edelman", "Ali Siddiq", "Fred Again", "Mira Holt"].map((n) => `${n} ${run}`);

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

test("a 10-act roster: full matrix, ranked pairings, estimate matches calls, scores link to evidence, a pair opens as a plan", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, EMAIL);

  await test.step("create a roster from the empty state", async () => {
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Rosters" }).click();
    await expect(page.getByRole("heading", { name: "No rosters yet" })).toBeVisible();
    await page.getByRole("textbox", { name: "Roster name" }).fill("North Star comedy");
    await page.getByRole("button", { name: "Create roster" }).click();
    await expect(page).toHaveURL(/\/workspace\/rosters\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "North Star comedy" })).toBeVisible();
  });

  await test.step("add nine acts by name and one through the picker", async () => {
    const box = page.getByRole("textbox", { name: "Add an act" });
    for (const name of ACTS) {
      await box.fill(name);
      await box.press("Enter");
      await expect(page.locator(`[data-act="${name}"]`)).toBeVisible();
    }
    await box.fill("Mercury");
    await box.press("Enter");
    await expect(page.getByText("Found 2 matches for “Mercury”, which one?")).toBeVisible();
    await page.getByRole("option").first().click();
    await expect(page.locator("[data-act]")).toHaveCount(10);
    await expect(page.getByText(/^10 acts/)).toBeVisible();
    await expect(page.getByText("Not scored yet · refresh to score with Qloo")).toHaveCount(10);
  });

  let estimate = 0;
  await test.step("see what the refresh will use, then run it in staggered batches", async () => {
    const bar = page.getByLabel("Refresh");
    const line = bar.getByText(/To refresh: 10 acts: .* up to \d+ Qloo calls\./);
    await expect(line).toBeVisible();
    estimate = Number((await line.innerText()).match(/up to (\d+) Qloo calls/)![1]);
    await expect(bar.getByText(/of 500 Qloo calls left this month/)).toBeVisible();
    await bar.getByRole("button", { name: `Refresh · ${estimate} calls` }).click();
    await expect(page.getByText(/Refreshing in the background/).first()).toBeVisible();
    await expect(page.getByText("Not scored yet · refresh to score with Qloo")).toHaveCount(0, { timeout: 60_000 });
    await expect(bar.getByText(/Everything is up to date/)).toBeVisible({ timeout: 30_000 });
    // Nothing was cached for these acts, so every planned call was made.
    await expect(bar.locator("[data-estimate-check]")).toHaveText(new RegExp(`estimated ${estimate} Qloo calls, used ${estimate}\\.`));
  });

  await test.step("the matrix is full and every score links to its pair's evidence", async () => {
    const matrix = page.getByRole("table", { name: "Pairing matrix" });
    await expect(matrix.locator("[data-matrix-row]")).toHaveCount(10);
    await expect(matrix.getByRole("cell").getByRole("link")).toHaveCount(90);
    const cell = matrix.getByRole("cell").getByRole("link").first();
    const target = (await cell.getAttribute("href"))!;
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    const card = page.locator(target);
    await card.getByText("Evidence").click();
    await expect(card.getByText(/^Score \d+ = mean of/)).toBeVisible();
    await expect(card.getByText("GET /v2/insights").first()).toBeVisible();
    await expect(card.getByText(/filter\.results\.entities = /).first()).toBeVisible();
    const row = page.locator("[data-act]").first();
    await row.getByText("Evidence").click();
    await expect(row.getByText(/Qloo affinity \d\.\d\d, popularity/).first()).toBeVisible();
    await expect(row.getByText("GET /v2/insights").first()).toBeVisible();
  });

  let pair = "";
  await test.step("see the pairings, ranked, with Qloo evidence", async () => {
    const cards = page.locator("[data-pair]");
    await expect(cards).toHaveCount(45);
    pair = (await cards.first().getAttribute("data-pair"))!;
    await expect(cards.first().getByRole("meter")).toBeVisible();
    await expect(cards.first().getByText(/fans over-index on/).first()).toBeVisible();
    await expect(page.getByText(/It is not a share of fans/)).toBeVisible();
  });

  await test.step("open a pair as a plan, with the partner kept", async () => {
    const [a, b] = pair.split(" + ");
    await page.locator(`[data-pair="${pair}"]`).getByRole("button", { name: "Plan this pairing" }).click();
    await expect(page).toHaveURL(/\/run\?.*entity=.*partner=.*pc=/);
    expect(new URL(page.url()).searchParams.get("q")).toBe(a);
    await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(b, { exact: false }).first()).toBeVisible();
  });
});

test("a signed-out visitor is sent to sign in from rosters", async ({ page }) => {
  await page.goto("/workspace/rosters");
  await expect(page).toHaveURL(/\/signin\?next=(%2F|\/)workspace(%2F|\/)rosters/);
});
