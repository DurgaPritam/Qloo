"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FIELD } from "../account/fields";
import { Banner, Button, cx, MonoLabel, Panel, useCopy } from "../ui";

/** Settings → White-label: custom domain (DNS-verified), widget snippets and the sites allowed to embed them. */
export interface WhiteLabelView {
  allowed: boolean;
  canEdit: boolean;
  publicId: string;
  domain: string | null;
  txt: { name: string; value: string } | null;
  verified: boolean;
  embedOrigins: string[];
  hasBranding: boolean;
  appUrl: string;
  samplePlanId: string | null;
}

async function post(body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch("/api/workspace/white-label", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return { ok: Boolean(res?.ok), data: ((await res?.json().catch(() => null)) ?? {}) as Record<string, unknown> };
}

export function WhiteLabelSettings({ v }: { v: WhiteLabelView }) {
  const router = useRouter();
  const [domain, setDomain] = useState(v.domain ?? "");
  const [origins, setOrigins] = useState(v.embedOrigins.join("\n"));
  const [msg, setMsg] = useState<{ tone: "info" | "err" | "warn"; text: string } | null>(null);
  const { copied, copy } = useCopy();
  const base = v.verified && v.domain ? `https://${v.domain}` : v.appUrl;
  const snippets = [
    { key: "overlap", label: "Fan overlap widget", code: `<iframe src="${base}/embed/overlap?a=Phoebe%20Bridgers&b=PEN15&w=${v.publicId}" width="360" height="320" style="border:0" loading="lazy" title="Fan overlap"></iframe>` },
    ...(v.samplePlanId ? [{ key: "vote", label: "City vote widget (a public plan)", code: `<iframe src="${base}/embed/vote/${v.samplePlanId}?w=${v.publicId}" width="360" height="380" style="border:0" loading="lazy" title="City vote"></iframe>` }] : []),
  ];

  const act = async (body: unknown, done: (d: Record<string, unknown>) => string) => {
    const { ok, data } = await post(body);
    setMsg(ok ? { tone: "info", text: done(data) } : { tone: "err", text: String((data.error as string) ?? "That didn't work.") });
    if (ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-[18px]">
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {!v.allowed && <Banner tone="neutral">Your logo, colours and a custom domain come with a plan that includes white-label. Widgets and the sites allowed to embed them work on every plan.</Banner>}
      <Panel>
        <MonoLabel>Logo and colours</MonoLabel>
        <p className="m-0 text-body">
          Shared plans and widgets use the same logo and colours as your decks. {v.hasBranding ? "They are set." : "None set yet: they use Takeover's look."} <a href="/workspace/settings/branding">Edit them in Branded decks →</a>
        </p>
      </Panel>
      <Panel>
        <MonoLabel>Custom domain</MonoLabel>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ domain }, () => (domain.trim() ? "Saved. Add the TXT record below, then check it." : "Custom domain removed."));
          }}
        >
          <input value={domain} onChange={(e) => setDomain(e.target.value)} disabled={!v.canEdit || !v.allowed} placeholder="plans.yourcompany.com" aria-label="Custom domain" className={cx(FIELD, "min-w-0 flex-1 basis-[240px] font-mono disabled:opacity-55")} />
          {v.canEdit && v.allowed && (
            <Button type="submit" variant="primary">
              Save domain
            </Button>
          )}
        </form>
        {v.domain && v.txt && !v.verified && (
          <div className="flex flex-col gap-2 text-chip" data-txt>
            <span>Add this DNS record, then check it:</span>
            <code className="font-mono [overflow-wrap:anywhere]">
              TXT {v.txt.name} “{v.txt.value}”
            </code>
            <span className="text-mute">Also point the domain at the app (CNAME) and add it to the hosting project; until then the check passes but the domain does not load.</span>
            {v.canEdit && (
              <span>
                <Button onClick={() => void act({ verify: true }, (d) => (d.verified ? "Verified. Shared plans and widgets are served on the domain." : "The TXT record was not found yet. DNS can take a while; try again later."))}>Check DNS</Button>
              </span>
            )}
          </div>
        )}
        {v.domain && v.verified && <span className="text-chip" data-domain-verified>Verified: public plans open at https://{v.domain}/p/… with your brand. Only shared plans and widgets are served there.</span>}
      </Panel>
      <Panel>
        <MonoLabel>Widgets</MonoLabel>
        <span className="text-chip text-mute">Widget id {v.publicId}. Each widget is a self-contained page with a strict Content-Security-Policy: it loads nothing from elsewhere and never uses cookies.</span>
        {snippets.map((s) => (
          <div key={s.key} className="flex flex-col gap-1.5">
            <span className="text-chip font-medium">{s.label}</span>
            <code className="rounded-md bg-bg p-2 font-mono text-label [overflow-wrap:anywhere]" data-snippet={s.key}>
              {s.code}
            </code>
            <span>
              <Button onClick={() => copy(s.key, s.code)}>{copied === s.key ? "Copied" : "Copy"}</Button>
            </span>
          </div>
        ))}
        <label className="flex flex-col gap-1.5">
          <span className="text-chip font-medium">Sites allowed to embed them (one per line; empty: any site)</span>
          <textarea rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} disabled={!v.canEdit} placeholder="https://www.yourcompany.com" aria-label="Allowed sites" className={cx(FIELD, "font-mono disabled:opacity-55")} />
        </label>
        {v.canEdit && (
          <span>
            <Button onClick={() => void act({ embedOrigins: origins }, (d) => ((d.embedOrigins as string[]).length ? `Widgets can be embedded on ${(d.embedOrigins as string[]).length} site(s) only.` : "Widgets can be embedded on any site."))}>Save sites</Button>
          </span>
        )}
      </Panel>
    </div>
  );
}
