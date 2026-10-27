import Link from "next/link";

import type { Trend } from "@/lib/server/trending";
import { citySlug, overlapHref } from "@/lib/site";

import { planHref } from "./showcase";
import { MonoLabel } from "./ui";

/** This week's most-used pairs, cities and fanbases on Takeover; counts are visits, not Qloo scores. */
export function TrendingStrip({ pairs, cities, fanbases, sep }: { pairs: Trend[]; cities: Trend[]; fanbases: Trend[]; sep: string }) {
  const cols = [
    {
      title: "Overlaps people checked",
      items: pairs.map((t) => {
        const [a, b] = t.member.split(sep);
        return { key: t.member, label: `${a} × ${b}`, href: overlapHref(a, b), count: t.count };
      }),
    },
    {
      title: "Cities plans landed in",
      items: cities.map((t) => {
        const [name, country] = t.member.split("|");
        return { key: t.member, label: country ? `${name}, ${country}` : name, href: `/city/${citySlug(name)}`, count: t.count };
      }),
    },
    {
      title: "Fanbases planned",
      items: fanbases.map((t) => ({ key: t.member, label: t.member, href: planHref(t.member), count: t.count })),
    },
  ].filter((c) => c.items.length > 0);
  if (!cols.length) return null;
  return (
    <section className="flex flex-col gap-[18px] border-t border-line pt-[18px]">
      <MonoLabel>Trending on Takeover this week</MonoLabel>
      <div className="grid gap-[22px] md:grid-cols-3">
        {cols.map((c) => (
          <div key={c.title} className="flex flex-col gap-1.5">
            <div className="text-body font-medium">{c.title}</div>
            <ol className="m-0 flex list-none flex-col p-0">
              {c.items.map((i, n) => (
                <li key={i.key} className="flex items-baseline gap-2 border-b border-line py-1.5 text-chip">
                  <span className="tabular w-5 font-mono text-mute">{n + 1}</span>
                  <Link href={i.href} className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    {i.label}
                  </Link>
                  <span className="tabular font-mono text-mute">{i.count}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
