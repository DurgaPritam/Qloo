import { useEffect, useState } from 'react';
import { Page, AppHeader, Panel, MonoLabel, InputBar, Chip, Banner, SourceBadge, ConfirmPill, DotMap, Legend, EntityCard, Button, Sk, cx } from '../components/ui';

/* Each state is its own component so it can be dropped into the real flow. <EdgeStates/> lays them out as a gallery. */

const StateTag = ({ id, label }: { id: string; label: string }) => (
  <div className="flex items-center gap-2">
    <span className="rounded-badge bg-ink px-[7px] py-px font-mono text-[11px] text-bg">{id}</span>
    <MonoLabel>{label}</MonoLabel>
  </div>
);

/* (a) Several entities match */
const MATCHES = [
  { name: 'Phoenix', cat: 'Music artist', detail: 'French indie-pop band, formed 1995 in Versailles' },
  { name: 'Phoenix Suns', cat: 'Sports team', detail: 'NBA team, Western Conference' },
  { name: 'Phoenix', cat: 'Film', detail: '2014 German drama, dir. Christian Petzold' },
  { name: 'Joaquin Phoenix', cat: 'Actor', detail: 'Star of Joker (2019) and Her (2013)' }
];
export function EntityPicker({ query = 'Phoenix', onPick }: { query?: string; onPick?: (i: number) => void }) {
  const [picked, setPicked] = useState(0);
  return (
    <Panel className="gap-3.5">
      <InputBar size="md" value={query} onChange={() => {}} />
      <div className="text-body font-medium">Four entities match “Phoenix”. Which one?</div>
      <div role="radiogroup" className="flex flex-col gap-1.5">
        {MATCHES.map((m, i) => (
          <button key={i} type="button" role="radio" aria-checked={i === picked} onClick={() => { setPicked(i); onPick?.(i); }}
            className={cx('grid cursor-pointer grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border bg-bg p-2 text-left font-body text-ink', i === picked ? 'border-acc-line' : 'border-line')}>
            {/* Replace with the entity image from Qloo */}
            <div className="flex size-[52px] items-center justify-center rounded-btn bg-[repeating-linear-gradient(135deg,var(--track)_0_6px,var(--surf)_6px_12px)] font-mono text-[9px] uppercase text-mute">img</div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-body text-[16px] font-semibold leading-[1.2]">{m.name}</span>
                <span className="rounded-badge bg-acc-soft px-1.5 py-px font-mono text-label uppercase tracking-[0.06em] text-acc-text">{m.cat}</span>
              </div>
              <span className="text-chip text-mute">{m.detail}</span>
            </div>
            <span className="pr-1.5 font-mono text-label uppercase tracking-[0.06em] text-acc-text">{i === picked ? 'Selected' : ''}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

/* (b) No match */
export function NoMatch() {
  const [query, setQuery] = useState('Ali Wnog');
  return (
    <Panel className="gap-3.5">
      <InputBar size="md" value={query} onChange={setQuery} />
      <div className="flex flex-col gap-1.5 pb-1 pt-3">
        <h3 className="t-display m-0 text-[28px] leading-[0.92]">We couldn't find that fanbase</h3>
        <p className="m-0 text-body text-mute">Qloo has no entity called “Ali Wnog”. Did you mean one of these?</p>
      </div>
      <div className="flex flex-wrap gap-2">{['Ali Wong', 'Ali Wang', 'Alli Wong'].map(s => <Chip key={s} label={s} onClick={() => setQuery(s)} />)}</div>
    </Panel>
  );
}

/* (c) Niche act, thin data → wider region */
const REGIONS = [['Pacific Northwest', 14, 26, 74, true], ['Upper Midwest', 55, 28, 61], ['Northeast', 84, 30, 58], ['Mountain West', 32, 50, 52]] as const;
export function ThinData() {
  return (
    <>
      <Banner tone="warn">Thin data for Mira Holt Trio: too few city-level signals to rank cities. Showing regions instead.</Banner>
      <Panel className="gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MonoLabel>City · region level</MonoLabel><ConfirmPill>Fallback · wider region</ConfirmPill>
        </div>
        <DotMap points={REGIONS.map(([name, x, y, score, top]) => ({ name, x: 20 + x * 0.62, y, score, size: Math.round(40 + (score - 50) * 2.4), tone: top ? 'acc' : 'mute' }))} />
        <Legend items={[{ tone: 'acc', label: 'Strongest region' }, { tone: 'mute', label: 'Other regions' }]} />
        <p className="m-0 text-chip text-mute">Pacific Northwest leads. Pick a city inside it to continue, or keep the region and choose venues later.</p>
      </Panel>
    </>
  );
}

/* (d) No tagged venues → nearest city */
export function NearestCity({ onKeep, onPickAnother }: { onKeep?: () => void; onPickAnother?: () => void }) {
  return (
    <>
      <Banner tone="warn">Boise has no tagged venues for this audience. Using Salt Lake City, the nearest city with a match.</Banner>
      <Panel className="gap-3.5">
        <MonoLabel>Room &amp; sponsors</MonoLabel>
        <EntityCard role="Venue" name="The Depot" meta="Salt Lake City · Music venue · Downtown" badges={<>
          <ConfirmPill>Nearest city · not Boise</ConfirmPill><SourceBadge /><ConfirmPill>Capacity · to confirm with promoter</ConfirmPill>
        </>} />
        <div className="flex flex-wrap gap-2"><Button onClick={onKeep}>Keep Salt Lake City</Button><Button onClick={onPickAnother}>Pick another city</Button></div>
      </Panel>
    </>
  );
}

/* (e) API busy */
const CACHED = [['Comedian', 'Ali Wong'], ['Music artist', 'Fred again..'], ['Film', 'Dune: Part Two'], ['Sports team', 'Golden State Warriors']];
export function ApiBusy({ onRetry, onOpenCached }: { onRetry?: () => Promise<void>; onOpenCached?: (name: string) => void }) {
  const [retryIn, setRetryIn] = useState(8);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (retrying || retryIn <= 0) return;
    const id = setTimeout(() => setRetryIn(n => n - 1), 1000);
    return () => clearTimeout(id);
  }, [retryIn, retrying]);
  const retry = async () => { setRetrying(true); await (onRetry?.() ?? new Promise(r => setTimeout(r, 1400))); setRetrying(false); setRetryIn(8); };
  const disabled = retrying || retryIn > 0;
  return (
    <Panel>
      <Banner tone="info" action={
        <Button variant="primary" className="tabular px-3.5 py-[7px]" disabled={disabled} onClick={retry}>
          {retrying ? 'Retrying…' : retryIn > 0 ? `Retry in ${retryIn}s` : 'Retry now'}
        </Button>}>
        <span className="text-body">Qloo is busy right now. Your plan for Ali Wong is saved, so nothing is lost.</span>
      </Banner>
      <div className="flex flex-col gap-2">
        <MonoLabel>While you wait · cached examples</MonoLabel>
        <div className="flex flex-wrap gap-2">{CACHED.map(([k, n]) => <Chip key={n} kind={k} label={n} onClick={() => onOpenCached?.(n)} />)}</div>
        <p className="m-0 text-chip text-mute">Cached plans open instantly and show the date their Qloo data was pulled.</p>
      </div>
    </Panel>
  );
}

/* (f) Loading skeletons, one per results section */
export const CrossoverSkeleton = () => (
  <Panel className="gap-2.5"><MonoLabel>Crossover</MonoLabel>
    <div className="grid grid-cols-2 gap-2"><Sk.card /><Sk.card /></div><Sk.bar /><Sk.lineShort /></Panel>
);
export const MapSkeleton = () => (
  <Panel className="gap-2.5"><MonoLabel>City</MonoLabel><Sk.map /><div className="flex gap-3"><Sk.legend /><Sk.legend /><Sk.legend /></div></Panel>
);
export const RoomSkeleton = () => (
  <Panel className="gap-2.5"><MonoLabel>Room &amp; sponsors</MonoLabel><Sk.card /><Sk.row /><Sk.row /><Sk.row /></Panel>
);
export const BriefSkeleton = () => (
  <Panel className="gap-2.5"><MonoLabel>Brief</MonoLabel><Sk.title /><Sk.line /><Sk.line /><Sk.lineShort /></Panel>
);
export const OutreachSkeleton = () => (
  <Panel className="gap-2.5"><MonoLabel>Outreach</MonoLabel><Sk.lineShort /><Sk.lineShort /><Sk.block /></Panel>
);

export default function EdgeStates() {
  const cell = 'flex min-w-0 flex-col gap-2.5';
  return (
    <Page max="max-w-[1240px]">
      <AppHeader context="Edge states" />
      <div className="grid items-start gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr))]">
        <section id="a" className={cell}><StateTag id="a" label="Several matches" /><EntityPicker /></section>
        <section id="b" className={cell}><StateTag id="b" label="No match" /><NoMatch /></section>
        <section id="c" className={cell}><StateTag id="c" label="Thin data · niche act" /><ThinData /></section>
        <section id="d" className={cell}><StateTag id="d" label="No tagged venues" /><NearestCity /></section>
        <section id="e" className={cell}><StateTag id="e" label="API busy" /><ApiBusy /></section>
        <section id="f" className={cell}>
          <StateTag id="f" label="Loading skeletons" />
          <div className="flex flex-col gap-2">
            <CrossoverSkeleton /><MapSkeleton /><RoomSkeleton />
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]"><BriefSkeleton /><OutreachSkeleton /></div>
          </div>
        </section>
      </div>
    </Page>
  );
}
