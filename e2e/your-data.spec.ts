import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Your data: upload a CSV, map columns, check unclear cities, attach it to a fanbase, rank cities
 * by Qloo signal, your data and combined, see the same columns in a plan's city step, and delete
 * it with one click. Another workspace never sees it (the not-found page, as for a private plan).
 */

const run = Math.random().toString(36).slice(2, 8);
const CSV = [
  "metro_name,country,tix,show_date",
  "Los Angeles,US,1742,2026-03-14",
  "Chicago,US,1310,2026-04-02",
  "Brooklyn,US,1655,2026-04-18",
  "Austin,US,1120,2026-05-09",
  "Springfield,US,240,2026-05-12",
  "Zzxq Town,US,12,2026-05-23",
].join("\n");

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: test.info().project.use.extraHTTPHeaders });
  return context.newPage();
}

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

test("upload, map, review, attach, rank with three columns, see it in a plan, delete", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPage(browser);
  const other = await newPage(browser);
  await signIn(page, `dara.${run}@e2e.test`);
  let datasetUrl = "";
  let planUrl = "";

  await test.step("empty state, then upload a CSV and map its columns", async () => {
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Data" }).click();
    await expect(page.getByRole("heading", { name: "No data sources added" })).toBeVisible();
    await page.getByRole("link", { name: "Upload CSV" }).click();
    await page.getByLabel("Data file").setInputFiles({ name: "ticket_sales_2026.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
    await expect(page.getByText("Map columns · ticket_sales_2026.csv")).toBeVisible();
    await expect(page.getByLabel("Map metro_name")).toHaveValue("city");
    await expect(page.getByLabel("Map country")).toHaveValue("country");
    await expect(page.getByLabel("Map tix")).toHaveValue("tickets");
    await expect(page.getByLabel("Map show_date")).toHaveValue("ignore");
    await expect(page.getByRole("table", { name: "Preview" }).getByRole("row")).toHaveCount(6);
    await page.getByRole("button", { name: "Upload and match cities" }).click();
    await expect(page).toHaveURL(/\/workspace\/data\/[0-9a-f-]{36}$/);
    datasetUrl = page.url();
  });

  await test.step("check the cities that did not match", async () => {
    const review = page.getByRole("list", { name: "Cities to check" });
    await expect(review.locator("[data-review]")).toHaveCount(2);
    await review.locator('[data-review="Springfield"]').getByRole("button", { name: /Springfield, Missouri/ }).click();
    await expect(review.locator("[data-review]")).toHaveCount(1);
    await review.locator('[data-review="Zzxq Town"]').getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("list", { name: "Cities to check" })).toHaveCount(0);
  });

  await test.step("attach to a fanbase and rank: Qloo signal, your data, combined", async () => {
    await page.getByLabel("Attach to a fanbase").fill("Phoebe Bridgers");
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    await expect(page.getByText(/Attached to/)).toBeVisible();
    const table = page.getByRole("table", { name: "Cities: Qloo signal, your data, combined" });
    for (const h of ["◆ Qloo signal", "■ Your data", "◆■ Combined"]) await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
    await expect(page.locator("[data-formula]")).toHaveText(/Combined = 0\.5 × Qloo signal \+ 0\.5 × Your data/);
    // At full weight on your data, a city in the file scores its own tickets: Los Angeles is the best city, 100.
    await page.getByLabel("Weight on your data").fill("100");
    await expect(page.locator("[data-formula]")).toHaveText(/Combined = 0\.0 × Qloo signal \+ 1\.0 × Your data/);
    const la = table.locator('[data-city="Los Angeles"]').getByRole("cell");
    await expect(la.nth(3)).toContainText("100");
    await expect(la.nth(3)).toContainText("1,742");
    await expect(la.nth(4)).toHaveText("100");
    // Brooklyn's tickets count towards New York City.
    await expect(table.locator('[data-city="New York City"]').getByRole("cell").nth(3)).toContainText("1,655");
    // Every number in the row traces back: Qloo heat and its request, the file's rows, the arithmetic.
    await table.locator('[data-city="Los Angeles"]').getByRole("button", { name: "Where these numbers come from" }).click();
    const trace = page.locator('[data-trace="Los Angeles"]');
    await expect(trace.getByText(/Phoebe Bridgers fans' heat in Los Angeles, \d\.\d{3} over \d+ cells, ÷ their hottest city's/)).toBeVisible();
    await expect(trace.getByText(/row 2 “Los Angeles” 1,742 in ticket_sales_2026\.csv/)).toBeVisible();
    await expect(trace.getByText(/= 0\.0 × \d+ \+ 1\.0 × 100\./)).toBeVisible();
    await trace.getByText("Qloo requests").click();
    await expect(trace.getByText("filter.type = urn:heatmap")).toBeVisible();
    await page.getByRole("tab", { name: "Map" }).click();
    await page.getByRole("tab", { name: "■ Your data" }).click();
    await expect(page.getByRole("img", { name: /Top cities by your data/ }).or(page.getByLabel(/Top cities by your data/)).first()).toBeVisible();
  });

  await test.step("another workspace cannot open it", async () => {
    await signIn(other, `ola.${run}@e2e.test`);
    await other.goto(datasetUrl);
    await expect(other.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    await expect(other.getByText("ticket_sales_2026.csv")).toHaveCount(0);
  });

  await test.step("a plan for that fanbase shows the three columns in its city step", async () => {
    await page.goto("/run?q=Phoebe%20Bridgers");
    await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
    const mine = page.locator("[data-plan-your-data]");
    await expect(mine).toBeVisible();
    await expect(mine.getByText("ticket_sales_2026.csv", { exact: false })).toBeVisible();
    for (const h of ["◆ Qloo signal", "■ Your data", "◆■ Combined"]) await expect(mine.getByRole("columnheader", { name: h })).toBeVisible();
    const first = mine.locator("[data-city]").first();
    await first.getByRole("button", { name: "Where these numbers come from" }).click();
    await expect(mine.locator("[data-trace]").getByText(/√\(Phoebe Bridgers fans/).or(mine.locator("[data-trace]").getByText(/is not in|has no heat/)).first()).toBeVisible();
    planUrl = page.url();
  });

  await test.step("delete it with one click", async () => {
    await page.goto(datasetUrl);
    await page.getByRole("button", { name: "Delete this data and its file" }).click();
    await expect(page.getByText("Deleted: the rows and the file are gone from this workspace.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No data sources added" })).toBeVisible();
    await page.goto(datasetUrl);
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  });

  await test.step("and gone from every view: the plan's city step and the activity log", async () => {
    await page.goto(planUrl);
    await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/With Qloo rank vs population rank/)).toBeVisible();
    await expect(page.locator("[data-plan-your-data]")).toHaveCount(0);
    await page.goto("/workspace/settings");
    await expect(page.getByText("deleted data and its file")).toBeVisible();
    await expect(page.getByText("ticket_sales_2026.csv")).toHaveCount(0);
  });
});
