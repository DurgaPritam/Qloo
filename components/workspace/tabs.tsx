"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx, MonoLabel, OutlineChip } from "../ui";

const TABS = [
  { href: "/workspace", label: "Plans" },
  { href: "/workspace/rosters", label: "Rosters" },
  { href: "/workspace/data", label: "Data" },
  { href: "/workspace/members", label: "Members" },
  { href: "/workspace/inbox", label: "Inbox" },
  { href: "/workspace/settings", label: "Settings" },
] as const;

/** The workspace's title and its pages, styled like the site nav. */
export function WorkspaceTabs({ name, role }: { name: string; role: string }) {
  const path = usePathname();
  return (
    <section className="flex flex-col gap-3 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonoLabel>Workspace</MonoLabel>
        <OutlineChip>{role}</OutlineChip>
      </div>
      <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92] [overflow-wrap:anywhere]">{name}</h1>
      <nav aria-label="Workspace" className="-mx-1 flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const here = path === t.href || (t.href !== "/workspace" && path.startsWith(`${t.href}/`));
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={here ? "page" : undefined}
              className={cx(
                "whitespace-nowrap rounded-btn px-2.5 py-1 text-chip no-underline",
                here ? "bg-acc-soft font-medium text-ink" : "text-mute hover:bg-acc-soft hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
