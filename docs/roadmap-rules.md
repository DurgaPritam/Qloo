# Roadmap rules: Takeover as a team product

These rules apply to every change that adds accounts, workspaces, stored customer data,
background jobs, email or billing. They add to CLAUDE.md; they never relax it. The architecture
that implements them is in [architecture.md](architecture.md).

## 1. Every existing rule still applies

- Scores, rankings and numbers come only from `lib/engine` using Qloo results. The model chooses
  tools and writes prose; it never produces a number.
- Never invent capacity, dates, prices or availability. Show "to confirm with the promoter".
- Every Qloo call goes through `lib/qloo/client.ts`, which handles the cache, timeout, retry and
  budgets.
- Every step has a fallback that explains what happened and continues with the best result,
  labelled.
- Keys and tokens stay on the server. They are never sent to the browser or logged.
- The UI uses the design system in `/design` only. No new colours or components.

## 2. User-supplied data is labelled, never blended

A user may enter their own data: ticket sales, attendance, fees, constraints (for example "no
venues over 500", "not before March").

- It is stored with `source = "user"`, along with who entered it and when.
- It is always shown with a **Your data** label. A Qloo number is never shown with that label.
- It is never mixed into a Qloo number without showing both parts. A figure that combines the
  two shows the Qloo part, the user part and the rule that combines them. For example:
  "Qloo affinity 0.92 · your 2025 sell-through 78% (Your data)", not one blended score.
- Constraints filter or flag results. They never change a Qloo score.
- What the user entered is not checked against reality and is never presented as checked.

## 3. Every customer table has workspace_id, and every query is scoped

- Every table that holds customer data has a non-null `workspace_id`. Identity tables (the
  Auth.js users, sessions and verification tokens) belong to a person, not a workspace, and are
  linked to workspaces through `memberships`.
- Route handlers, server actions and jobs never import the raw database client. They use the
  scoped repository, `forWorkspace(db, ctx)`, which adds `workspace_id = <the request's
  workspace>` to every read and write. The context comes only from `lib/workspace/session.ts`,
  which checks the membership first.
- A job runs for one workspace, named in its payload. It checks that the workspace still
  exists, and that its subscription allows the job, before doing anything.
- `tests/support/scoped-queries.ts` fails a test when SQL touches a workspace table without a
  `workspace_id` condition. Every test that touches the database records its queries with the
  Drizzle logger and ends with `expectAllScoped(queries, TENANT_TABLES)`. `TENANT_TABLES` is
  derived from the schema: every table with a `workspace_id` column.
- Cross-workspace reads are named `unscoped*` and live in `lib/db/unscoped.ts`, which only
  `lib/workspace` and `lib/auth.ts` may import (ESLint enforces this). They are the lookups that
  find a workspace in the first place, and nothing else:
  - the signed-in user's own memberships (to pick the request's workspace);
  - a plan's owning workspace and visibility, for `/plan/<id>` (the plan itself is returned only
    when it is public);
  - an invitation by the hash of its token, and accepting it (the writes still carry
    `workspace_id`);
  - creating a personal workspace on first sign-in;
  - for the weekly market watch tick, which workspaces have a watch due and an owner to act as
    (each job then works through `forWorkspace` only);
  - turning off one person's digest in one workspace from the signed unsubscribe link;
  - for the hourly tick, which workspaces have an overdue pipeline card not yet reminded, and an
    owner to act as (the job then works through `forWorkspace` only);
  - turning off one person's pipeline reminder emails from their signed (reminders-only) link;
  - for the public API, the workspace of a key, by the key's hash (the request then works through
    `forWorkspace` as the key's creator, who must still be a member).
  Admin scripts, when they exist, follow the same naming.

## 4. Background jobs respect the Qloo budget

The Qloo client enforces two limits, in addition to the 25-calls-per-run cap:

- **A monthly allowance per workspace**: Qloo calls a workspace may make in a calendar month,
  set by its plan.
- **A global daily cap**: Qloo calls the whole deployment may make in a UTC day, across all
  workspaces, anonymous visitors and jobs.

Both are checked before each uncached call; cache hits are free. If either limit is reached, the
call fails with a budget error that names the limit. A job then stops, records "skipped:
budget", and tells the workspace in the product what it did not do. It never retries until the
next period. Interactive users see the same labelled fallback as today. Jobs share the daily cap
with users, so a job never runs with less than a reserved share of the cap left for interactive
use (`QLOO_JOB_RESERVE`, in architecture.md).

## 5. Nothing is sent on a user's behalf without an explicit click

- No feature sends an email or a message to a third party (a promoter, venue, sponsor or agent)
  unless the user clicked Send on that exact message. That covers jobs, schedules, "send all",
  and the model.
- The Send click creates a single-use confirmation for that draft's exact content. If the draft
  changes, the confirmation no longer matches and nothing is sent.
- The model writes drafts only. It has no send tool.
- Email to the user themselves (sign-in links, invites they asked for, alerts and digests they
  turned on) is not "on their behalf". It still needs an opt-in, and every alert has an
  unsubscribe link.
- Every message sent is logged in the workspace: who clicked, when, to whom, and the content.
