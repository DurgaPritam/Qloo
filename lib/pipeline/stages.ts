/** The pipeline's stages and card kinds, shared by the schema, the server and the board. */
export const OUTREACH_STAGES = ["drafted", "sent", "replied", "negotiating", "booked", "lost"] as const;
export type OutreachStage = (typeof OUTREACH_STAGES)[number];
export type OutreachKind = "partner" | "venue" | "sponsor";

export const STAGE_LABEL: Record<OutreachStage, string> = {
  drafted: "Drafted",
  sent: "Sent",
  replied: "Replied",
  negotiating: "Negotiating",
  booked: "Booked",
  lost: "Lost",
};

export const isStage = (s: unknown): s is OutreachStage => typeof s === "string" && (OUTREACH_STAGES as readonly string[]).includes(s);
