import { connection } from "next/server";

import { ogCard, OG_SIZE, posterImage } from "@/lib/og";
import { loadLineup } from "@/lib/tools/lineup";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A Takeover lineup poster";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const l = await loadLineup((await params).id);
  if (!l) return ogCard({ kicker: "Lineup builder", title: "Takeover", lines: ["Build a lineup the crowd will love."] });
  return posterImage(
    { title: l.title, headliner: l.headliner.name, acts: l.acts.map((a) => a.name), host: l.host?.name ?? null, city: l.city?.name ?? null, venue: l.venue, crowdFit: l.crowdFit },
    OG_SIZE,
  );
}
