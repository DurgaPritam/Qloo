import { ogCard, OG_SIZE } from "@/lib/og";
import { fanPersona } from "@/lib/tools/fan";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Meet the fan, on Takeover";

/** The share card for a persona: the intro sentence Qloo's data wrote. */
export default async function Image({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name).slice(0, 100);
  const r = await fanPersona(name);
  if (r.status !== "done") return ogCard({ kicker: "Meet the fan", title: name, lines: ["Who the fans are, from Qloo taste data."] });
  return ogCard({ kicker: "Meet the fan", title: `The ${r.fanbase.name} fan`, lines: [r.intro.slice(0, 150)], badge: "◆ Every fact from Qloo taste data" });
}
