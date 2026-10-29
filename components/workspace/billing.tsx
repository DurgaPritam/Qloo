"use client";

import { useState } from "react";

import { FIELD } from "../account/fields";
import { Banner, Button, ConfirmPill, cx, MonoLabel, Panel, ScoreBar, Segmented } from "../ui";

/** Settings → Plans & billing, as in the design: tier cards, the period switch, usage and invoices. */
export type Interval = "month" | "year";

export interface PriceProps {
  interval: Interval;
  unitAmount: number | null;
  currency: string;
}
export interface CardProps {
  tier: string;
  label: string;
  blurb: string;
  features: string[];
  selfServe: boolean;
  get: "included" | "checkout" | "contact";
  perSeat: boolean;
  prices: PriceProps[];
}
export interface UsageProps {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  upgrade: { tier: string; label: string; selfServe: boolean } | null;
}
export interface InvoiceProps {
  id: string;
  created: string;
  amount: number;
  currency: string;
  status: string;
  pdf: string | null;
  lines: string;
}

/** Stripe keeps amounts in the currency's minor unit (cents); Intl knows how many digits it has. */
export function money(amount: number, currency: string) {
  const fmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() });
  return fmt.format(amount / 10 ** (fmt.resolvedOptions().maximumFractionDigits ?? 2));
}

const RANK = (cards: CardProps[], tier: string) => cards.findIndex((c) => c.tier === tier);

export function BillingScreen({
  cards,
  current,
  canManage,
  notReady,
  preselect,
  seatsInUse,
  subscribed,
}: {
  cards: CardProps[];
  current: string;
  canManage: boolean;
  notReady: string | null;
  preselect: string | null;
  seatsInUse: number;
  subscribed: { interval: string | null } | null;
}) {
  const [interval, setPeriod] = useState<Interval>(subscribed?.interval === "year" ? "year" : "month");
  const [pending, setPending] = useState<string | null>(
    canManage && !notReady && cards.some((c) => c.tier === preselect && c.get === "checkout" && c.tier !== current) ? preselect : null,
  );
  const [seats, setSeats] = useState(String(Math.max(1, seatsInUse)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cur = RANK(cards, current);
  const target = cards.find((c) => c.tier === pending) ?? null;
  const priceOf = (c: CardProps) => c.prices.find((p) => p.interval === interval) ?? null;

  const go = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { url?: string; error?: string };
    if (!res?.ok || !data.url) {
      setBusy(false);
      return setError(data.error ?? "That didn't work. Try again.");
    }
    window.location.assign(data.url);
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex justify-end">
        <Segmented
          label="Billing period"
          value={interval}
          onChange={setPeriod}
          options={[
            { value: "month", label: "Monthly" },
            { value: "year", label: "Annual" },
          ]}
        />
      </div>
      {error && <Banner tone="err">{error}</Banner>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] items-stretch gap-2" role="list" aria-label="Plans">
        {cards.map((c, i) => {
          const isCur = c.tier === current;
          const price = priceOf(c);
          const up = i > cur;
          const cta = isCur ? "Current plan" : c.get === "contact" ? "Talk to us" : up ? `Upgrade to ${c.label}` : `Switch to ${c.label}`;
          return (
            <article
              key={c.tier}
              role="listitem"
              data-tier={c.tier}
              className={cx("flex flex-col gap-3.5 rounded-lg bg-surf p-panel shadow-card border-th", isCur ? "border-acc-line" : "border-transparent")}
            >
              <div className="flex items-center justify-between gap-2">
                <MonoLabel className="text-acc-text">{c.label}</MonoLabel>
                {isCur && <span className="rounded-pill bg-acc px-2 font-mono text-label uppercase tracking-[0.06em] text-on-acc">Current</span>}
              </div>
              <div className="flex flex-wrap items-baseline gap-1.5">
                {c.get === "checkout" && price?.unitAmount == null ? (
                  <span data-price>
                    <ConfirmPill>Price to confirm</ConfirmPill>
                  </span>
                ) : (
                  <span className="t-display tabular text-[clamp(34px,5vw,52px)] leading-[0.85]" data-price>
                    {c.get === "included" ? "Free" : c.get === "contact" ? "Custom" : money(price!.unitAmount!, price!.currency)}
                  </span>
                )}
                <span className="text-chip text-mute">
                  {c.selfServe ? (price?.unitAmount != null ? `${c.perSeat ? "per seat " : ""}${interval === "year" ? "per year" : "per month"}` : "set in Stripe") : ""}
                </span>
              </div>
              <span className="min-h-[3em] text-chip text-mute">{c.blurb}</span>
              <ul className="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
                {c.features.map((f) => (
                  <li key={f} className="grid grid-cols-[1em_minmax(0,1fr)] gap-1.5 text-body">
                    <span className="font-mono text-acc-text">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {c.get === "checkout" ? (
                <Button
                  variant={up && !isCur ? "primary" : "secondary"}
                  className="min-h-11 px-4 py-2.5 text-body font-semibold"
                  disabled={isCur || !canManage || Boolean(notReady)}
                  onClick={() => setPending(c.tier)}
                >
                  {cta}
                </Button>
              ) : c.get === "included" ? (
                <Button className="min-h-11 px-4 py-2.5 text-body font-semibold" disabled>
                  {isCur ? "Current plan" : "Included"}
                </Button>
              ) : (
                <a href="#contact" className="min-h-11 rounded-btn bg-acc px-4 py-2.5 text-center text-body font-semibold text-on-acc no-underline hover:text-on-acc">
                  {isCur ? "Current plan" : cta}
                </a>
              )}
            </article>
          );
        })}
      </div>
      <span className="text-chip text-mute">
        Prices come from Stripe and exclude tax. Annual plans are charged once a year. Moving to a lower plan keeps everything already saved, read-only.
        {!canManage && " Only the workspace's owners can change the plan."}
      </span>

      {target && (
        <div role="status" className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-md border border-acc-line bg-surf px-3.5 py-3">
          <span className="min-w-[200px] flex-1 text-body">
            Move this workspace to {target.label}, billed {interval === "year" ? "annually" : "monthly"}
            {priceOf(target)?.unitAmount != null ? ` at ${money(priceOf(target)!.unitAmount!, priceOf(target)!.currency)}${target.perSeat ? " a seat" : ""}` : ""}. You confirm and
            pay on Stripe&apos;s page.
          </span>
          {target.perSeat && (
            <label className="flex items-center gap-2 text-chip">
              Seats
              <input
                type="number"
                min={Math.max(1, seatsInUse)}
                max={500}
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
                className={cx(FIELD, "w-[90px]")}
                aria-label="Seats"
              />
            </label>
          )}
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void go("/api/workspace/billing/checkout", { tier: target.tier, interval, seats: target.perSeat ? Number(seats) : undefined })}
          >
            Continue to Stripe
          </Button>
          <Button onClick={() => setPending(null)}>Cancel</Button>
        </div>
      )}
      {subscribed && canManage && !notReady && (
        <div>
          <Button loading={busy} onClick={() => void go("/api/workspace/billing/portal", {})}>
            Manage billing: card, seats, invoices, cancel →
          </Button>
        </div>
      )}
    </div>
  );
}

export function UsagePanel({ rows, title = "Usage this period" }: { rows: UsageProps[]; title?: string }) {
  return (
    <Panel className="gap-3">
      <MonoLabel>{title}</MonoLabel>
      {rows.map((u) => {
        const text =
          u.limit === null
            ? `${u.used.toLocaleString("en-GB")} · no limit`
            : u.limit === 0
              ? u.used
                ? `${u.used.toLocaleString("en-GB")} · not on this plan`
                : "Not on this plan"
              : `${u.used.toLocaleString("en-GB")} of ${u.limit.toLocaleString("en-GB")}`;
        const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
        return (
          <div key={u.key} className="flex flex-col gap-1.5" data-usage={u.key}>
            <div className="flex justify-between gap-2 text-body">
              <span>{u.label}</span>
              <span className="tabular whitespace-nowrap text-right font-mono text-chip">{text}</span>
            </div>
            <ScoreBar value={pct} label={text} className="[&>span]:hidden" />
            {u.upgrade && (
              <a href={u.upgrade.selfServe ? `/workspace/settings/billing?tier=${u.upgrade.tier}` : "/workspace/settings/billing#contact"} className="text-chip">
                {u.limit === 0 ? `${u.upgrade.label} includes this →` : `At the limit: ${u.upgrade.label} raises it →`}
              </a>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

export function Invoices({ invoices, note }: { invoices: InvoiceProps[]; note: string | null }) {
  return (
    <Panel className="gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_7em_4em] gap-2.5 border-b border-line pb-2 font-mono text-label uppercase tracking-[0.06em] text-mute">
        <span>Invoices</span>
        <span className="text-right">Amount</span>
        <span />
      </div>
      {invoices.length === 0 && <p className="m-0 py-2.5 text-chip text-mute">{note ?? "No invoices yet."}</p>}
      {invoices.map((i) => (
        <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_7em_4em] items-center gap-2.5 border-b border-line py-2.5">
          <span className="flex min-w-0 flex-col">
            <span>{new Date(i.created).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
            <span className="truncate text-chip text-mute">
              {i.lines || "Subscription"} · {i.status}
            </span>
          </span>
          <span className="tabular text-right font-mono">{money(i.amount, i.currency)}</span>
          {i.pdf ? (
            <a href={i.pdf} className="text-right text-chip" target="_blank" rel="noreferrer">
              PDF
            </a>
          ) : (
            <span />
          )}
        </div>
      ))}
    </Panel>
  );
}

export function ContactForm({ name: initial, email }: { name: string; email: string | null }) {
  const [name, setName] = useState(initial);
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setState("busy");
    setError(null);
    const res = await fetch("/api/workspace/billing/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, company, message }),
    }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { error?: string };
    if (!res?.ok) {
      setState("idle");
      return setError(data.error ?? "That didn't send. Try again.");
    }
    setState("sent");
  };
  return (
    <section id="contact" aria-label="Contact us about Enterprise" className="scroll-mt-6">
      <Panel className="gap-3">
        <MonoLabel>Enterprise · contact us</MonoLabel>
        <p className="m-0 text-body text-mute">
          Your data + Qloo, market watch, sponsorship, outcome reports, the API and white-label. Tell us what you need; Enterprise is set up by hand.
        </p>
        {state === "sent" ? (
          <Banner tone="info">Sent. We&apos;ll reply to {email ?? "you"}.</Banner>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {error && <Banner tone="err">{error}</Banner>}
            <div className="flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="Your name"
                aria-label="Your name"
                className={cx(FIELD, "min-w-0 flex-1 basis-[200px]")}
              />
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                maxLength={120}
                placeholder="Company"
                aria-label="Company"
                className={cx(FIELD, "min-w-0 flex-1 basis-[200px]")}
              />
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="What would you use Takeover for?"
              aria-label="Message"
              className={FIELD}
            />
            <div>
              <Button type="submit" variant="primary" loading={state === "busy"} disabled={!name.trim() || !message.trim()}>
                Send
              </Button>
            </div>
          </form>
        )}
      </Panel>
    </section>
  );
}
