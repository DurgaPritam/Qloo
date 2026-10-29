import type { ReactNode } from "react";

import { AppHeader, Banner, MonoLabel, Page, Panel } from "../ui";

/** A legal page: flagged as a placeholder until a lawyer has reviewed it. */
export function LegalPage({ label, title, updated, children }: { label: string; title: string; updated: string; children: ReactNode }) {
  return (
    <Page>
      <AppHeader />
      <section className="flex flex-col gap-1.5 pt-4">
        <MonoLabel>{label}</MonoLabel>
        <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92]">{title}</h1>
        <p className="m-0 text-chip text-mute">Last updated {updated}</p>
      </section>
      <Banner tone="warn">
        <span data-legal-placeholder>Placeholder, not yet reviewed by a lawyer. It describes how Takeover works today; the final wording will replace it before launch.</span>
      </Banner>
      {children}
    </Page>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel className="gap-2">
      <MonoLabel>{title}</MonoLabel>
      <div className="flex flex-col gap-2 text-body [&_p]:m-0 [&_ul]:m-0 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1 [&_ul]:pl-5">{children}</div>
    </Panel>
  );
}
