# Architecture: Takeover as a team product (proposal)

Status: **foundation built on branch `roadmap/foundation`**: database, auth, workspaces, plans,
comments (sections marked *Built*). Jobs, Blob and Stripe are still proposals. The rules this
design must keep are in [roadmap-rules.md](roadmap-rules.md).

## What changes and what stays

The public site stays as it is, with no sign-in: plans, tools, Daily, city pages, shared links.
That is the growth loop. Signing in adds a **workspace**, where a team can:
- save plans and keep notes on them
- enter its own data (ticket sales, fees, constraints)
- track outreach
- watch fanbases and cities for changes
- export branded decks
- pay

Redis (Upstash) keeps the jobs it does today: the Qloo response cache, rate limits, the token
budget, votes and trending. It also takes on the two new Qloo counters, because they must be
atomic and fast. Postgres holds everything a customer owns.

## The parts

| Part | Choice | Why |
| --- | --- | --- |
| Database | **Neon Postgres** with **Drizzle ORM** (*Built*) | On the Vercel Marketplace, branch databases for previews; Drizzle gives typed SQL and SQL-first migrations we can read. Production uses the `postgres` driver on Neon's pooled URL (transactions work, unlike the HTTP driver). Local dev, unit tests and e2e use **PGlite** (Postgres in WebAssembly) with the same migrations; Vercel refuses to start without `DATABASE_URL`. |
| Auth | **Auth.js (v5)** with email magic links, the Drizzle adapter, database sessions (*Built*) | No passwords to store. Sessions live in Postgres, so they can be revoked. Requests without a session cookie never touch the database. |
| Email | **Resend** (*Built* for sign-in and invites) | Sign-in links, invites, later opt-in alerts and outreach the user clicks Send on. Without `RESEND_API_KEY`, local runs and e2e use an in-memory outbox at `/dev/outbox`; it never exists on Vercel, where sending fails closed. |
| Background jobs | **Upstash QStash** | Already on Upstash. Signed HTTP calls to our own routes, with retries, delays, schedules and a dead-letter queue. One message per workspace, so a failure never stops everyone's job. |
| Files | **Vercel Blob** | Exported decks and PDFs, posters, uploaded CSVs of ticket sales. |
| Billing | **Stripe** | Checkout to subscribe, the Customer Portal to change or cancel, webhooks to sync the plan. |

Alternatives considered:
- **Database:** Supabase (it adds its own auth and storage, which would overlap with Auth.js and
  Blob) and Vercel Postgres (now provided by Neon).
- **Jobs:** Vercel Cron. It is simpler, but the Hobby plan runs a job at most once a day, and it
  has no retries or per-workspace fan-out. Vercel Cron could trigger the daily schedule with
  QStash fanning it out, but QStash schedules make the cron unnecessary.

## Diagram

```mermaid
flowchart LR
  subgraph Browser
    UI[Pages and tools]
  end

  subgraph Vercel["Next.js on Vercel"]
    RH[Route handlers and server actions]
    AUTH[Auth.js: magic links, database sessions]
    REPO["Scoped repository forWorkspace(session)"]
    AGENT[Agent and tools: lib/agent, lib/tools]
    ENGINE[lib/engine: every number]
    QC["lib/qloo/client.ts: cache, timeout, retry, run cap, workspace monthly allowance, global daily cap"]
    LLM[lib/llm: prose only, token budget]
    JOBS["/api/jobs/*: QStash-signed only"]
    HOOK["/api/stripe/webhook: Stripe-signed only"]
  end

  subgraph Data
    PG[(Neon Postgres via Drizzle)]
    REDIS[(Upstash Redis: cache, limits, Qloo counters)]
    BLOB[(Vercel Blob: exports, posters, uploads)]
  end

  subgraph External
    QLOO[Qloo Insights API]
    MODEL[Gemini or Claude]
    RESEND[Resend]
    QSTASH[Upstash QStash]
    STRIPE[Stripe]
  end

  UI --> RH
  RH --> AUTH --> PG
  RH --> REPO --> PG
  RH --> AGENT --> ENGINE
  AGENT --> QC --> QLOO
  QC <--> REDIS
  AGENT --> LLM --> MODEL
  RH --> BLOB
  AUTH --> RESEND
  RH -- "Send click only" --> RESEND
  QSTASH -- "signed call per workspace" --> JOBS
  JOBS --> REPO
  JOBS --> AGENT
  JOBS -- "opt-in alerts" --> RESEND
  RH -- "Checkout, Portal" --> STRIPE
  STRIPE -- "signed webhook" --> HOOK --> REPO
```

## Data model (first cut)

Every table except the identity tables has `workspace_id uuid not null` and an index that
starts with it.

| Table | Holds | Scope |
| --- | --- | --- |
| `users`, `accounts`, `sessions`, `verification_tokens` | Auth.js identity | Per person (identity only) |
| `workspaces` | name, plan, Stripe customer id | The tenant itself, keyed by `id` |
| `memberships` | `workspace_id`, `user_id`, role (owner, admin, member, viewer) | workspace |
| `invites` | email, hashed token, expiry, invited by | workspace |
| `plans` (*Built*) | run id, input, the stored plan JSON, created by, visibility (workspace or public), imported from | workspace |
| `comments` (*Built*) | plan, target (plan, partner, city, venue, sponsor) and its id, parent (one level of threading), author, body, resolved | workspace |
| `notifications` (*Built*) | in-app @mentions | workspace |
| `activity_log` (*Built*) | who did what | workspace |
| `user_facts` | kind (ticket_sales, attendance, fee, constraint), value, unit, `source = 'user'`, entered by, entered at | workspace |
| `outreach` | plan, recipient, draft, status (draft, sent, replied, booked), `sent_by`, `sent_at`, content hash | workspace |
| `send_confirmations` | one-time token for one draft's content hash, expiry | workspace |
| `watches` | a fanbase or city to watch, last Qloo snapshot, frequency, opt-in for email | workspace |
| `job_runs` | job kind, status (done, skipped: budget, failed), Qloo calls used, error | workspace |
| `exports` | Blob path, kind (deck, PDF, CSV, poster), created by | workspace |
| `subscriptions` | Stripe subscription id, price, status, current period end | workspace |
| `audit_log` | who did what (invite, role change, send, export, billing) | workspace |

`user_facts` stays separate from anything Qloo produced, so the "Your data" label is a property
of where a value comes from, not something added by hand when it is shown.

## How the rules are enforced

### Workspace scoping (rule 3)

- `lib/db/index.ts` creates the Drizzle client. Only `lib/db/scoped.ts` and admin scripts may
  import it, and an ESLint `no-restricted-imports` rule enforces that.
- `forWorkspace(session)` checks that the user is a member of the workspace, then returns
  repository functions that add `workspace_id` to every `where` and every insert.
- In tests, the Drizzle logger records SQL and `expectAllScoped()`
  (`tests/support/scoped-queries.ts`, already written and tested) fails on any workspace table
  touched without a `workspace_id` condition.
- Later, as a second layer: Postgres row-level security, with the workspace id set per
  transaction. It is not in the first cut because the HTTP driver has no long-lived sessions to
  carry the setting.

### Qloo budget (rule 4)

The client's `get(path, params, { runId })` gains a `scope`:
`{ kind: "visitor" } | { kind: "workspace", workspaceId } | { kind: "job", workspaceId }`.

Before each uncached call, one Redis script atomically:

1. checks and increments `qloo:daily:<UTC date>` against `QLOO_DAILY_CALL_CAP`;
2. for a job, refuses if fewer than `QLOO_JOB_RESERVE` calls of the daily cap are left, which
   keeps a share for people using the site;
3. for a workspace or a job, checks and increments `qloo:ws:<id>:<YYYY-MM>` against that
   workspace's allowance. The allowance comes from its plan, falling back to
   `QLOO_WORKSPACE_MONTHLY_CALLS`.

If any check fails, nothing is incremented and the call throws `BudgetExceededError` with the
limit's name. Cache hits are never counted. The existing per-run cap of 25 stays as it is. The
health page shows today's global count and the cap.

### Email (rule 5)

- `lib/email/send.ts` is the only module that calls Resend. It has two entry points:
  - `sendToSelf(userId, template)`: sign-in, invites and opt-in alerts.
  - `sendOutreach(confirmationToken)`: everything else.
- `sendOutreach` checks the token, its expiry and that it is single-use. It also checks that the
  draft's content hash still matches what the user saw when they clicked. Then it sends, writes
  `outreach.sent_*` and the audit log, and burns the token.
- Jobs and the agent cannot mint confirmation tokens; only the Send server action can. A unit
  test checks that no file under `lib/agent`, `lib/tools` or `app/api/jobs` imports
  `sendOutreach`.

### User data (rule 2)

- Each value is read with its `source`. The UI component for a user value always renders the
  **Your data** label.
- A combined view (for example Qloo affinity next to sell-through) is built by code in
  `lib/engine` and shows both parts and the rule that joins them.

## Background jobs (first ones)

| Job | Schedule | Qloo calls | Output |
| --- | --- | --- | --- |
| Watch refresh | Weekly per workspace (QStash schedule fans out one message per workspace) | Small and fixed per watch; counted against the workspace | "What changed" in the workspace; an email only if opted in |
| Export render | On click | None | A deck or PDF in Blob |
| Stripe sync | On webhook | None | `subscriptions` and `workspaces.plan` |
| Usage rollup | Daily | None | Copies the Redis counters into Postgres for the usage page and billing |

Job routes check the QStash signature, read `workspace_id` from the payload, load that
workspace through the scoped repository, and record a `job_runs` row whatever happens.

## Files

- **Posters:** shared on purpose, so they are public in Blob, under random paths.
- **Exports and uploads:** customer data. They are served through
  `/api/files/[id]`, which checks the session's workspace before streaming from Blob. Whether
  Vercel Blob's private access mode should be used instead is checked when it is installed.
- **Uploaded CSVs:** parsed on the server into `user_facts` with `source = 'user'`. They are
  size-limited and never executed.

## Billing

- **Plans:** Free (today's site, plus one workspace with a small Qloo allowance), Pro and Team.
  Each plan sets seats and the monthly Qloo allowance.
- **Flow:**
  - Checkout runs from a server action, so no Stripe key reaches the browser.
  - The webhook (signature checked) updates `subscriptions` and `workspaces.plan`.
  - The Customer Portal handles changes and cancellations.
- **Prices:** set in Stripe and referenced by price id. The app never states a price it did not
  read from Stripe.
- **Before charging:** a commercial Qloo agreement, terms and a privacy policy
  (docs/go-to-market.md).

## New environment variables

All are server-only. None has a `NEXT_PUBLIC_` prefix.

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Drizzle (runtime) | Neon pooled connection string |
| `DATABASE_URL_UNPOOLED` | drizzle-kit migrations | Neon direct connection |
| `AUTH_SECRET` | Auth.js | Random 32+ bytes |
| `AUTH_URL` | Auth.js | Only outside Vercel; Vercel sets the host |
| `RESEND_API_KEY` | Resend | Also passed to the Auth.js Resend provider |
| `EMAIL_FROM` | Resend | For example `Takeover <hello@your-domain>`, on a verified domain |
| `APP_URL` | Emails, QStash callbacks, Stripe return URLs | The public base URL |
| `QSTASH_TOKEN` | Publishing and scheduling jobs | |
| `QSTASH_CURRENT_SIGNING_KEY` | Verifying job calls | |
| `QSTASH_NEXT_SIGNING_KEY` | Verifying job calls during key rotation | |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob | Set automatically when a Blob store is linked |
| `STRIPE_SECRET_KEY` | Checkout, Portal | |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature | |
| `STRIPE_PRICE_PRO` | Checkout | Price id |
| `STRIPE_PRICE_TEAM` | Checkout | Price id |
| `QLOO_DAILY_CALL_CAP` | Qloo client | Global calls per UTC day |
| `QLOO_JOB_RESERVE` | Qloo client | Calls of the daily cap that jobs may not use |
| `QLOO_WORKSPACE_MONTHLY_CALLS` | Qloo client | Default allowance when a plan sets none |

## Build order (after approval)

1. **Database and the scoped repository.** Neon, Drizzle, a migration, `forWorkspace`, the
   ESLint import rule, and the logger wired to `expectAllScoped`.
2. **Qloo client scopes and the two counters.** Tests for each limit and for the job reserve.
3. **Auth.js magic links and workspaces.** Invites, memberships, a sign-in page in the design
   system, and saved plans moved from the browser into the workspace.
4. **User data.** `user_facts`, the "Your data" label, and the CSV upload to Blob.
5. **Outreach tracking and Send with confirmation.** Through Resend.
6. **Watches and the weekly job.** Through QStash.
7. **Stripe.** Plans, Checkout, webhook, Portal.

Each step lands with tests, passing checks and a decision entry, and is committed on its own.
