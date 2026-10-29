import { expect, type Page } from "@playwright/test";

import type { TierName } from "@/lib/entitlements";

/** Sets the signed-in user's current workspace to a plan tier (local and e2e only; billing does it for real). */
export async function useTier(page: Page, tier: TierName) {
  expect((await page.request.post("/api/dev/tier", { data: { tier } })).ok()).toBe(true);
}
