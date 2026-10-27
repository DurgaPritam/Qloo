"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Chip, InputBar, MonoLabel } from "./ui";

const EXAMPLES = ["Phoebe Bridgers", "Call Her Daddy", "Arsenal", "Succession", "Patagonia"];

export function FanSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, start] = useTransition();
  const go = (name: string) => name.trim() && start(() => router.push(`/fan/${encodeURIComponent(name.trim())}`));
  return (
    <div className="flex flex-col gap-3">
      <InputBar value={q} onChange={setQ} onSubmit={() => go(q)} onPick={go} placeholder="A fanbase, e.g. Phoebe Bridgers" buttonLabel="Meet the fan" busy={busy} />
      <div className="flex flex-wrap items-center gap-2">
        <MonoLabel>Try</MonoLabel>
        {EXAMPLES.map((e) => (
          <Chip key={e} label={e} onClick={() => go(e)} />
        ))}
      </div>
    </div>
  );
}
