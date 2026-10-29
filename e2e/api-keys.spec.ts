import { expect, test, type Page } from "@playwright/test";

/** Settings → API: a key is shown once, listed by its prefix only, used, and revoked. */
const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `kai.${run}@e2e.test`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await page.goto("/dev/outbox");
  const href = await page.locator(`[data-outbox-to="${email}"]`).first().locator("[data-outbox-link]").first().getAttribute("href");
  await page.goto(href!);
}

test("create an API key, use it, see the usage, revoke it", async ({ page, request }) => {
  await signIn(page, EMAIL);
  await page.goto("/workspace/settings");
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "API" }).click();
  await page.getByRole("textbox", { name: "Key name" }).fill("Website");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.locator("[data-new-key]").innerText()).trim();
  expect(key).toMatch(/^tk_/);
  await expect(page.locator('[data-key-row="Website"]')).toContainText(key.slice(0, 9));

  const res = await request.get(`/api/v1/venues?city=Austin`, { headers: { authorization: `Bearer ${key}` } });
  expect(res.status()).toBe(200);
  expect((await res.json()).attribution.source).toBe("Qloo");

  await page.reload();
  await expect(page.locator("[data-new-key]")).toHaveCount(0); // never shown again
  await expect(page.getByRole("region", { name: "Keys and usage" })).toContainText("/venues 1");
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.locator('[data-key-row="Website"]')).toContainText("revoked");
  expect((await request.get(`/api/v1/venues?city=Austin`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(401);

  await page.goto("/developers");
  await expect(page.getByRole("heading", { name: "Takeover API" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "POST /api/v1/plans" })).toBeVisible();
});
