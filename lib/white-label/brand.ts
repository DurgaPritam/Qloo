import "server-only";

import type { PublicBrand } from "@/lib/workspace/session";
import { entitlementsFor } from "@/lib/entitlements";

import type { BrandColours } from "./theme";

/**
 * How a workspace's public brand applies: its logo and colours only on a tier with white-label
 * (and only when it has set them); the sites allowed to embed its widgets on every tier.
 */
export function applied(brand: PublicBrand | null): { brand: { colours: BrandColours; logo: string | null; name: string } | null; frameAncestors: string[] } {
  if (!brand) return { brand: null, frameAncestors: [] };
  const on = entitlementsFor(brand.tier).whiteLabel && brand.branding;
  return {
    brand: on ? { colours: { bg: brand.branding!.bg, text: brand.branding!.text, accent: brand.branding!.accent }, logo: brand.branding!.logoData, name: brand.name } : null,
    frameAncestors: brand.embedOrigins,
  };
}
