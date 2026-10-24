import { CATEGORY_LABEL } from "@/lib/engine/explain";
import type { Category } from "@/lib/engine/types";

/** 0–1 engine value as a 0–100 integer for score bars. */
export const pct = (x: number) => Math.round(x * 100);
export const two = (x: number) => x.toFixed(2);

export function categoryLabel(c: Category): string {
  const l = CATEGORY_LABEL[c];
  return l.charAt(0).toUpperCase() + l.slice(1);
}

export function mailto(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function paragraphs(body: string): string[] {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

export const PROMOTER = "to confirm with the promoter";
