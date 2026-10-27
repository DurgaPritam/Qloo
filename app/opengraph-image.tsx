import { ogCard, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Takeover: event plans for anyone with a fanbase";

export default function Image() {
  return ogCard({
    kicker: "Event plans backed by taste data",
    title: "Pick a talent. Find the city. Get the plan.",
    lines: ["Crossover partner, city, venue, sponsors, brief and outreach. Powered by Qloo."],
    badge: "Free · no sign-up",
  });
}
