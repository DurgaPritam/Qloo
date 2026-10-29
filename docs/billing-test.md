# Billing: the test-card run

The "done when" for billing: a test card upgrades a workspace to Team, the new features unlock
immediately, cancelling in the Customer Portal downgrades it, and nothing is deleted. The unit
test `tests/workspace/billing.test.ts` ("done when …") runs this flow with Stripe's answers
stubbed. This is the same run against Stripe in test mode, once the test keys exist. Never with a
live key: billing refuses one.

Paid plans stay off in production until the commercial agreement with Qloo is in place
(`QLOO_COMMERCIAL_TERMS=1`); the hackathon Qloo key and quota can't serve paying customers.

## Set up (Stripe dashboard, test mode)

1. Products: Pro (flat) and Team (per unit, the seats), each with a monthly and an annual price.
   Put the four price ids in `.env.local`: `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`,
   `STRIPE_PRICE_TEAM_MONTHLY`, `STRIPE_PRICE_TEAM_ANNUAL`, and `STRIPE_SECRET_KEY` (`sk_test_…`).
2. Customer Portal (Settings → Billing → Customer portal): allow cancelling, switching between
   those four prices, and changing the quantity. For this run set cancellation to "immediately";
   with "at the end of the period" the workspace keeps Team until Stripe ends the subscription.
3. Webhooks: `stripe listen --forward-to localhost:3000/api/billing/webhook` and put the `whsec_…`
   it prints in `STRIPE_WEBHOOK_SECRET`. On a deployment, add an endpoint for
   `<APP_URL>/api/billing/webhook` with: checkout.session.completed,
   customer.subscription.created, customer.subscription.updated, customer.subscription.deleted,
   invoice.payment_failed, invoice.paid.

## Run

1. `npm run dev`, sign in, and save something on Free that stays readable (a run kept in My plans).
2. Settings → Plans & billing → Upgrade to Team → 3 seats → Continue to Stripe.
3. Pay with `4242 4242 4242 4242`, any future date, any CVC. Stripe returns through
   `/api/workspace/billing/return`, which reads the subscription back from Stripe.
   - Expect: the page says Team, 3 seats; Rosters lets you create a roster; Members lets you invite
     two people (a fourth seat asks for an upgrade). No refresh or wait for the webhook needed.
4. Manage billing → Cancel plan → Return to Takeover.
   - Expect: the page says Free; the roster, saved plans and pending invitations are all still
     listed; creating a roster shows "Team unlocks …" with the way back to Team.
5. Optional, a failed payment: upgrade with `4000 0000 0000 0341` (the card attaches, the charge
   fails). Expect the failed-payment banner; the plan follows Stripe's retries.
