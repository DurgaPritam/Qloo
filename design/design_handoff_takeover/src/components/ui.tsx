import React, { ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---------- Type ---------- */
export const MonoLabel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('font-mono text-label uppercase tracking-[0.08em] text-mute', className)}>{children}</div>
);

export const Wordmark = () => <div className="t-display text-[22px] leading-none uppercase">Takeover</div>;

export function AppHeader({ context, right }: { context?: string; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-[18px] gap-y-3 border-b border border-line pb-[18px] print:hidden">
      <Wordmark />
      {context && <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-mute">{context}</div>}
      <div className="flex-1" />
      {right}
    </header>
  );
}

/* ---------- Surfaces ---------- */
export const Panel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <section className={cx('flex flex-col gap-4 rounded-lg bg-surf p-panel', className)}>{children}</section>
);

export const Card = ({ children, className, inset }: { children: ReactNode; className?: string; inset?: boolean }) => (
  <div className={cx('flex min-w-0 flex-col rounded-md', inset ? 'border border-line bg-bg p-[18px]' : ' bg-surf p-[18px]', className)}>
    {children}
  </div>
);

/* ---------- Buttons ---------- */
type BtnVariant = 'primary' | 'secondary' | 'pick';
export function Button({ variant = 'secondary', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const v = {
    primary: 'bg-acc text-on-acc font-medium hover:brightness-110',
    secondary: 'bg-transparent text-ink border border-line hover:bg-acc-soft',
    pick: 'bg-transparent text-ink border border-line font-medium hover:bg-acc hover:text-on-acc hover:border-acc'
  }[variant];
  return <button type="button" className={cx('cursor-pointer whitespace-nowrap rounded-btn px-3 py-1.5 font-body text-chip disabled:cursor-default disabled:opacity-55', v, className)} {...p} />;
}

export function Segmented<T extends string>({ options, value, onChange, mono }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; mono?: boolean }) {
  return (
    <div role="tablist" className="flex gap-0.5 rounded-md bg-track p-[3px]">
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={cx('cursor-pointer rounded-btn border-0 px-3.5 py-1.5',
            mono ? 'font-mono text-label uppercase tracking-[0.06em]' : 'font-body text-chip font-medium',
            o.value === value ? 'bg-surf text-ink' : 'bg-transparent text-mute')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Input bar ---------- */
export function InputBar({ value, onChange, onSubmit, placeholder, size = 'lg', buttonLabel = 'Plan takeover' }:
  { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder?: string; size?: 'lg' | 'md'; buttonLabel?: string }) {
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit?.(); }}
      className={cx('flex items-center gap-2 rounded-md border border-line bg-surf', size === 'lg' ? 'py-2 pl-[18px] pr-2' : 'py-1.5 pl-3.5 pr-1.5')}>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder ?? 'Plan a takeover for'}
        className={cx('min-w-0 flex-1 border-0 bg-transparent font-body text-ink outline-none', size === 'lg' ? 'py-3 text-[20px] leading-[1.3]' : 'py-1.5 text-[16px]')} />
      <button type="submit" className={cx('flex-none cursor-pointer rounded-btn bg-acc font-medium text-on-acc hover:brightness-110', size === 'lg' ? 'px-5 py-3.5 text-body' : 'px-3.5 py-2 text-chip')}>
        {buttonLabel}
      </button>
    </form>
  );
}

/* ---------- Chips, badges, pills ---------- */
export const Chip = ({ kind, label, onClick }: { kind?: string; label: string; onClick?: () => void }) => (
  <button type="button" onClick={onClick}
    className="flex cursor-pointer items-baseline gap-1.5 rounded-pill border border-line bg-transparent px-3 py-[5px] font-body text-chip text-mute hover:border-acc-soft hover:bg-acc-soft hover:text-ink">
    {kind && <span className="font-mono text-label uppercase tracking-[0.06em]">{kind}</span>}
    <span>{label}</span>
  </button>
);

export const SourceBadge = ({ children = 'Qloo signal' }: { children?: ReactNode }) => (
  <span className="rounded-badge bg-acc-soft px-1.5 py-0.5 font-mono text-label uppercase tracking-[0.06em] text-acc-text">◆ {children}</span>
);

export const NoSourceBadge = () => (
  <span className="rounded-badge border border-line px-1.5 py-px font-mono text-label uppercase tracking-[0.06em] text-mute">No source</span>
);

export const ConfirmPill = ({ children }: { children: ReactNode }) => (
  <span className="inline-block max-w-full rounded-[12px] border border-dashed border-warn px-2 py-0.5 leading-[1.4] font-mono text-label uppercase tracking-[0.06em] text-warn">{children}</span>
);

export const OutlineChip = ({ children }: { children: ReactNode }) => (
  <span className="rounded-pill border border-line px-2.5 py-0.5 text-chip text-mute">{children}</span>
);

/* ---------- Score bar ---------- */
export function ScoreBar({ value, fill = 'acc', label, className }: { value: number | null; fill?: 'acc' | 'mute'; label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-pill bg-track">
        <div className={cx('h-full rounded-pill transition-[width] duration-500 ease-out', fill === 'acc' ? 'bg-acc-line' : 'bg-mute')} style={{ width: `${value ?? 0}%` }} />
      </div>
      <span className="tabular whitespace-nowrap font-mono text-chip">{label ?? (value == null ? '—' : `${value} / 100`)}</span>
    </div>
  );
}

/* ---------- Entity card ---------- */
export function EntityCard({ role, name, meta, badges, size = 28, inset = true }:
  { role?: string; name: string; meta: string; badges?: ReactNode; size?: 18 | 22 | 28 | 32; inset?: boolean }) {
  return (
    <Card inset={inset} className="gap-1.5">
      {role && <div className="font-mono text-label uppercase tracking-[0.08em] text-acc-text">{role}</div>}
      <div className={cx('[overflow-wrap:anywhere]', size >= 24 ? 't-display leading-none' : 'font-body font-semibold leading-[1.2]')} style={{ fontSize: size >= 24 ? size : size - 2 }}>{name}</div>
      <div className="text-chip text-mute">{meta}</div>
      {badges && <div className="flex flex-wrap gap-1.5 pt-1">{badges}</div>}
    </Card>
  );
}

/* ---------- Banners ---------- */
export function Banner({ tone, children, action }: { tone: 'info' | 'warn' | 'err' | 'neutral'; children: ReactNode; action?: ReactNode }) {
  const b = { info: 'border-acc-line', warn: 'border-warn', err: 'border-err', neutral: 'border-line' }[tone];
  return (
    <div role={tone === 'err' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-md border bg-surf px-3.5 py-2.5 text-chip text-ink', b)}>
      <span className="min-w-[200px] flex-1">{children}</span>
      {action}
    </div>
  );
}

/* ---------- Skeleton ---------- */
export const Skeleton = ({ className }: { className: string }) => <div className={cx('max-w-full flex-none animate-skel bg-track', className)} />;
export const Sk = {
  title: () => <Skeleton className="h-[26px] w-[45%] rounded-btn" />,
  line: () => <Skeleton className="h-3 w-full rounded-badge" />,
  lineShort: () => <Skeleton className="h-3 w-[60%] rounded-badge" />,
  bar: () => <Skeleton className="h-2 w-full rounded-pill" />,
  chip: () => <Skeleton className="h-[22px] w-40 rounded-pill" />,
  card: () => <Skeleton className="h-[104px] w-full rounded-md" />,
  row: () => <Skeleton className="h-10 w-full rounded-btn" />,
  block: () => <Skeleton className="h-[84px] w-full rounded-md" />,
  legend: () => <Skeleton className="h-3 w-[72px] rounded-badge" />,
  map: () => <Skeleton className="aspect-video w-full rounded-md" />
};

/* ---------- Table ---------- */
export function DataTable({ columns, rows, template }: { columns: string[]; rows: ReactNode[][]; template: string }) {
  return (
    <div className="flex flex-col text-chip">
      <div className="grid gap-2.5 border-b border-line pb-1.5 font-mono text-label uppercase tracking-[0.06em] text-mute" style={{ gridTemplateColumns: template }}>
        {columns.map((c, i) => <span key={c} className={i > 0 && i === columns.length - 1 ? 'text-right' : ''}>{c}</span>)}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2.5 border-b border-line py-[7px]" style={{ gridTemplateColumns: template }}>{r}</div>
      ))}
    </div>
  );
}
export const Num = ({ children, top, mute }: { children: ReactNode; top?: boolean; mute?: boolean }) => (
  <span className={cx('tabular text-right font-mono', top ? 'text-acc-text' : mute ? 'text-mute' : 'text-ink')}>{children}</span>
);

/* ---------- Map ---------- */
export type MapPoint = { name: string; score: number; x: number; y: number; size: number; tone: 'acc' | 'mute' | 'line'; ring?: boolean };
export function DotMap({ points, aspect = 'aspect-video' }: { points: MapPoint[]; aspect?: string }) {
  return (
    <div className={cx('relative overflow-hidden rounded-md bg-track', aspect)}>
      {points.map(p => (
        <div key={p.name} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
          <div className={cx('rounded-pill transition-colors', { acc: 'bg-acc-line', mute: 'bg-mute', line: 'bg-line' }[p.tone], p.ring && 'shadow-[0_0_0_4px_var(--acc-soft)]')}
            style={{ width: p.size, height: p.size }} />
          <span className="tabular whitespace-nowrap font-mono text-label text-ink">{p.name} {p.score}</span>
        </div>
      ))}
    </div>
  );
}
export const Legend = ({ items }: { items: { tone: 'acc' | 'mute' | 'line'; label: string }[] }) => (
  <div className="flex flex-wrap gap-x-[18px] gap-y-2 font-mono text-label uppercase tracking-[0.06em] text-mute">
    {items.map(i => (
      <span key={i.label} className="flex items-center gap-1.5">
        <span className={cx('size-2.5 rounded-pill', { acc: 'bg-acc-line', mute: 'bg-mute', line: 'bg-line' }[i.tone])} />{i.label}
      </span>
    ))}
  </div>
);

/* ---------- Email card ---------- */
export function EmailCard({ to, subject, body, copied, onCopy, mailto, showMailto = true }:
  { to: string; subject: string; body: string[]; copied?: boolean; onCopy: () => void; mailto?: string; showMailto?: boolean }) {
  return (
    <Card className="gap-3">
      <div className="flex flex-col font-mono text-[11px]">
        <div className="flex gap-2.5 border-b border-line py-1.5"><span className="w-[5em] flex-none text-mute">To</span><span>{to}</span></div>
        <div className="flex gap-2.5 border-b border-line py-1.5"><span className="w-[5em] flex-none text-mute">Subject</span><span>{subject}</span></div>
      </div>
      <div className="flex flex-col gap-2.5 text-body [text-wrap:pretty]">{body.map((p, i) => <p key={i} className="m-0">{p}</p>)}</div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button onClick={onCopy}>{copied ? 'Copied' : 'Copy'}</Button>
        {showMailto && mailto && <a href={mailto} className="rounded-btn border border-line px-3 py-1.5 text-chip text-ink no-underline hover:bg-acc-soft">Open in mail</a>}
      </div>
    </Card>
  );
}

/* ---------- Step card (agent log) ---------- */
export type StepStatus = 'waiting' | 'running' | 'done' | 'fallback' | 'error';
export type StepData = {
  n: string; title: string; status: StepStatus; seconds?: string; liveText?: string;
  branch?: string; fallbackText?: string; errorText?: string; decision?: string;
  endpoint?: string; params?: [string, string][];
};
const stepBorder = { waiting: 'border-line', running: 'border-acc-line', done: 'border-line', fallback: 'border-warn', error: 'border-err' };
const stepLabel = { waiting: 'text-mute', running: 'text-acc-text', done: 'text-acc-text', fallback: 'text-warn', error: 'text-err' };
const StepDot = ({ status }: { status: StepStatus }) => (
  <span className={cx('box-border size-2.5 flex-none rounded-pill', {
    waiting: 'border-[1.5px] border-line', running: 'animate-dot bg-acc-line', done: 'bg-acc-line', fallback: 'bg-warn', error: 'bg-err' }[status])} />
);
export function StepCard({ step, showBranch, open, onToggle, onRetry }: { step: StepData; showBranch?: boolean; open?: boolean; onToggle?: () => void; onRetry?: () => void }) {
  const s = step, complete = s.status === 'done' || s.status === 'fallback';
  const label = { waiting: 'Waiting', running: 'Running', done: `Done · ${s.seconds}`, fallback: `Fallback · ${s.seconds}`, error: 'Error' }[s.status];
  return (
    <div className={cx('flex flex-col gap-2 rounded-md border bg-surf px-4 py-3.5 transition-[opacity,border-color] duration-300', stepBorder[s.status], s.status === 'waiting' && 'opacity-55')}>
      <div className="flex items-center gap-2.5">
        <StepDot status={s.status} />
        <span className="tabular font-mono text-label text-mute">{s.n}</span>
        <span className="min-w-0 flex-1 text-body font-medium">{s.title}</span>
        <span className={cx('tabular whitespace-nowrap font-mono text-label uppercase tracking-[0.06em]', stepLabel[s.status])}>{label}</span>
      </div>
      {s.status === 'running' && <div className="font-mono text-[11px] text-mute">{s.liveText}</div>}
      {showBranch && s.branch && (
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 rounded-btn bg-acc-soft px-2.5 py-2">
          <span className="font-mono text-label uppercase tracking-[0.06em] text-acc-text">↳ Branch</span>
          <span className="text-chip text-ink">{s.branch}</span>
        </div>
      )}
      {s.status === 'fallback' && (
        <div className="flex flex-col gap-1 rounded-btn border border-dashed border-warn px-2.5 py-2">
          <span className="font-mono text-label uppercase tracking-[0.06em] text-warn">Fallback used</span>
          <span className="text-chip text-ink [text-wrap:pretty]">{s.fallbackText}</span>
        </div>
      )}
      {s.status === 'error' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-40 flex-1 text-chip text-ink">{s.errorText}</span>
          <Button variant="primary" onClick={onRetry}>Retry step</Button>
        </div>
      )}
      {complete && (
        <>
          <div className="text-body text-ink [text-wrap:pretty]">{s.decision}</div>
          <button type="button" onClick={onToggle} aria-expanded={open}
            className="flex w-full cursor-pointer items-center gap-2 border-0 border-t border-line bg-transparent pt-2 text-left text-mute">
            <span className="whitespace-nowrap font-mono text-label uppercase tracking-[0.06em] text-acc-text">◆ Qloo call</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{s.endpoint}</span>
            <span className="font-mono text-chip">{open ? '–' : '+'}</span>
          </button>
          {open && (
            <div className="flex flex-col gap-1 rounded-btn bg-bg px-3 py-2.5 font-mono text-[11px]">
              {s.params?.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,11em)_minmax(0,1fr)] gap-2.5">
                  <span className="text-mute [overflow-wrap:anywhere]">{k}</span><span className="text-ink [overflow-wrap:anywhere]">{v}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Page shell ---------- */
export const Page = ({ children, max = 'max-w-[880px]' }: { children: ReactNode; max?: string }) => (
  <div className="min-h-screen bg-bg font-body text-body text-ink print:bg-paper">
    <div className={cx('mx-auto box-border flex flex-col gap-[22px] p-panel', max)}>{children}</div>
  </div>
);

/* ---------- Clipboard helper ---------- */
export function useCopy() {
  const [copied, setCopied] = React.useState<string | null>(null);
  const t = React.useRef<ReturnType<typeof setTimeout>>();
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key); clearTimeout(t.current); t.current = setTimeout(() => setCopied(null), 1500);
  };
  return { copied, copy };
}
