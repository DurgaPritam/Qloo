import type { Metadata } from "next";

import { LegalPage, Section } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy · Takeover", description: "How Takeover handles personal data (placeholder, pending legal review)." };

export default function PrivacyPage() {
  return (
    <LegalPage label="Legal" title="Privacy" updated="29 Oct 2026">
      <Section title="What Takeover keeps">
        <ul>
          <li>Your email address and name, to sign you in and show who did what in a workspace.</li>
          <li>What your workspace saves: plans, comments, rosters, uploads (Your data), outreach notes and results you log.</li>
          <li>For paid plans: your Stripe customer id, plan, seats and payment status. Card details go to Stripe and never reach Takeover.</li>
          <li>A one-way hash of your IP address, briefly, to rate-limit requests. The address itself is not stored.</li>
        </ul>
      </Section>
      <Section title="Who processes it">
        <ul>
          <li>Vercel hosts the site; Neon hosts the database; Upstash caches Qloo answers and keeps usage counters.</li>
          <li>Qloo receives the fanbases, places and brands you search for, not who you are.</li>
          <li>
            The language model provider (Google Gemini by default) receives the names and Qloo results a plan, brief or digest is written from; never your account details or Your
            data.
          </li>
          <li>Resend sends sign-in links, invitations and the emails you turn on. Stripe takes payments.</li>
        </ul>
      </Section>
      <Section title="Cookies and storage">
        <p>
          Takeover sets only the cookies it needs to work: your sign-in session and which workspace you are in. Your browser also keeps your saved plans, theme and Daily game
          progress in its own storage.
        </p>
        <p>There are no analytics or advertising cookies, so there is no cookie banner. If analytics is added, a cookie notice will come with it.</p>
      </Section>
      <Section title="Your choices">
        <p>
          You can delete anything your workspace saved, leave a workspace, and unsubscribe from the weekly digest and pipeline reminders from the link in each one. Exporting or
          deleting your account in one step isn&apos;t built yet; until it is, ask us and we will do it.
        </p>
      </Section>
      <Section title="Still to be written">
        <ul>
          <li>The controller&apos;s identity and contact details, and the legal bases for each use.</li>
          <li>How long each kind of data is kept, and international transfers.</li>
          <li>Your rights under GDPR, UK GDPR and US state laws, and how to complain.</li>
        </ul>
      </Section>
    </LegalPage>
  );
}
