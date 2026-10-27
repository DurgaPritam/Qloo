import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CityTasteView } from "@/components/tools/city-taste";
import { AppHeader, Page, Skeleton } from "@/components/ui";
import { loadShowcase } from "@/lib/server/showcase";
import { cityTaste } from "@/lib/tools/city-page";

const titleCase = (slug: string) =>
  decodeURIComponent(slug)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export async function generateMetadata({ params }: PageProps<"/city/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const name = titleCase(slug);
  const title = `${name}'s taste: who to book, who to sponsor · Takeover`;
  const description = `The artists, stand-up comedians, podcasts and brands ${name} over-indexes on, from Qloo taste data.`;
  return { title, description, openGraph: { title, description } };
}

async function CityLoader({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [taste, showcase] = await Promise.all([cityTaste(slug), loadShowcase()]);
  if (!taste) notFound();
  const landed = showcase.filter((p) => p.city === taste.city.name && p.country === taste.city.country);
  return <CityTasteView result={taste} landed={landed} />;
}

export default function CityPage({ params }: PageProps<"/city/[slug]">) {
  return (
    <Page max="max-w-[1180px]">
      <AppHeader />
      <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-md" />}>
        <CityLoader params={params} />
      </Suspense>
      <p className="m-0 text-chip text-mute">
        <Link href="/city">All city pages</Link>
      </p>
    </Page>
  );
}
