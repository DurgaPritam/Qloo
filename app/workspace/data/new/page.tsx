import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { MonoLabel, Skeleton } from "@/components/ui";
import { DataUpload } from "@/components/workspace/your-data";
import { can } from "@/lib/workspace/permissions";
import { featureAccess } from "@/lib/workspace/gate";
import { currentWorkspace } from "@/lib/workspace/session";

export const metadata: Metadata = { title: "Upload data · Takeover", robots: { index: false } };

async function Content() {
  const found = await currentWorkspace();
  if (!found) redirect("/signin?next=/workspace/data/new");
  if (!can(found.ctx.role, "data.edit") || !(await featureAccess(found.repo, "data.uploads")).allowed) redirect("/workspace/data");
  return <DataUpload />;
}

export default function NewDataPage() {
  return (
    <>
      <Link href="/workspace/data" className="pt-4 text-chip text-mute">
        ← Your data
      </Link>
      <section className="flex flex-col gap-1.5">
        <MonoLabel>Data</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,5vw,40px)] leading-[0.92]">Your data</h1>
        <p className="m-0 text-chip text-mute">Upload your own sales or CRM export. Takeover keeps it separate from Qloo signal and shows both.</p>
      </section>
      <Suspense fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}>
        <Content />
      </Suspense>
    </>
  );
}
