import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FanView } from "@/components/fan-view";
import { AppHeader, Banner, MonoLabel, Page, Panel, Skeleton } from "@/components/ui";
import { fanPersona } from "@/lib/tools/fan";

const nameOf = (raw: string) => decodeURIComponent(raw).trim().slice(0, 100);

export async function generateMetadata({ params }: PageProps<"/fan/[name]">): Promise<Metadata> {
  const name = nameOf((await params).name);
  const title = `Meet the ${name} fan · Takeover`;
  const description = `Who ${name} fans are and what else they love, from Qloo taste data.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

async function FanLoader({ params, searchParams }: PageProps<"/fan/[name]">) {
  const name = nameOf((await params).name);
  const id = (await searchParams).id;
  const r = await fanPersona(name, typeof id === "string" ? id : undefined);
  if (r.status === "none") return <Banner tone="neutral">We couldn&apos;t find a fanbase called “{name}”. <Link href="/fan">Try another</Link></Banner>;
  if (r.status === "choose") {
    return (
      <Panel>
        <h1 className="m-0 text-[20px] font-semibold">{r.question}</h1>
        {r.choices.map((c) => (
          <Link key={c.entityId} href={`/fan/${encodeURIComponent(name)}?id=${encodeURIComponent(c.entityId)}`}>
            {c.name} <span className="text-mute">· {c.category.replace("_", " ")}{c.detail ? ` · ${c.detail}` : ""}</span>
          </Link>
        ))}
      </Panel>
    );
  }
  return <FanView result={r} />;
}

export default function FanPage(props: PageProps<"/fan/[name]">) {
  return (
    <Page max="max-w-[1120px]">
      <AppHeader />
      <Suspense
        fallback={
          <>
            <MonoLabel>Meet the fan</MonoLabel>
            <Skeleton className="h-[320px] w-full rounded-md" />
          </>
        }
      >
        <FanLoader {...props} />
      </Suspense>
    </Page>
  );
}
