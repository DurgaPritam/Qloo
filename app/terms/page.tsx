import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, Section } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms · Takeover", description: "Takeover's terms of service (placeholder, pending legal review)." };

export default function TermsPage() {
  return (
    <LegalPage label="Legal" title="Terms of service" updated="29 Oct 2026">
      <Section title="The service">
        <p>Takeover turns a fanbase into an event plan: a crossover partner, a city, venues, sponsors, a brief and outreach drafts, scored from Qloo taste data.</p>
        <p>Plans are a starting point, not advice. Capacity, dates, prices and availability are never known to Takeover and are always to confirm with the promoter or venue.</p>
      </Section>
      <Section title="Accounts and workspaces">
        <p>
          You sign in with a link sent to your email. A workspace&apos;s owners decide who joins it and what each member may do, and are responsible for the people they invite.
        </p>
        <p>Nothing is sent on your behalf without your click: outreach drafts open in your own email, and invitations go out only when you press Send.</p>
      </Section>
      <Section title="Plans and billing">
        <p>
          Free, Pro and Team are described on the <Link href="/workspace/settings/billing">Plans &amp; billing</Link> page; Enterprise is agreed with us directly. Payments are
          taken by Stripe. You can change or cancel a plan in Stripe&apos;s billing portal; a cancelled plan runs to the end of the period you paid for.
        </p>
        <p>Moving to a lower plan never deletes your data: what you saved stays readable, and you can still delete it.</p>
      </Section>
      <Section title="Your content and your data">
        <p>What you upload (Your data) and write (plans, comments, notes) stays yours. You let Takeover store and process it only to run the service for your workspace.</p>
        <p>Your data is kept separate from Qloo&apos;s data, labelled as yours, and never shown to another workspace.</p>
      </Section>
      <Section title="Third-party data">
        <p>Taste data comes from Qloo and is used under Takeover&apos;s agreement with Qloo. City data is from GeoNames (CC BY 4.0) and map outlines from Natural Earth.</p>
      </Section>
      <Section title="Still to be written">
        <ul>
          <li>Acceptable use, liability, warranties and indemnities.</li>
          <li>Governing law and how disputes are settled.</li>
          <li>Refunds, taxes and the notice given before price changes.</li>
          <li>The API and white-label terms for Enterprise.</li>
        </ul>
      </Section>
    </LegalPage>
  );
}
