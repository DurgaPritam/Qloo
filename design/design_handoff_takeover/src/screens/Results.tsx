import { useEffect, useRef, useState } from 'react';
import {
  Page, AppHeader, Panel, MonoLabel, SourceBadge, ConfirmPill, ScoreBar, DotMap, Legend, DataTable, Num,
  Banner, Button, Segmented, EntityCard, EmailCard, useCopy, cx
} from '../components/ui';

const CITIES = [
  { name: 'Los Angeles', x: 14, y: 58, score: 91, qr: 1, pr: 2, venue: 'The Wiltern', venueMeta: 'Theater · Koreatown', opener: 'Dana Kim', openerMeta: 'Stand-up · hosts a weekly LA showcase',
    spots: [['Late Seoul', 'Korean bar · open late · Koreatown'], ['Normandie Room', 'Cocktail bar · 4 min walk'], ['Sixth St. Noodle', 'Noodle bar · late kitchen']] },
  { name: 'Chicago', x: 62, y: 30, score: 79, qr: 2, pr: 3, venue: 'Chicago Theatre', venueMeta: 'Theater · The Loop', opener: 'Marcus Bell', openerMeta: 'Stand-up · Chicago club regular',
    spots: [['State St. Supper Club', 'Late dining · The Loop'], ['Wacker Room', 'Cocktail bar · 6 min walk'], ['Night Owl Dumplings', 'Dumplings · late kitchen']] },
  { name: 'New York', x: 86, y: 16, score: 77, qr: 3, pr: 1, venue: 'Beacon Theatre', venueMeta: 'Theater · Upper West Side', opener: 'Priya Raman', openerMeta: 'Stand-up · NYC club regular',
    spots: [['Broadway Late', 'Bar · Upper West Side'], ['74th St. Kitchen', 'Late dining · 3 min walk'], ['Riverside Ramen', 'Ramen · late kitchen']] },
  { name: 'Austin', x: 47, y: 76, score: 72, qr: 4, pr: 26, venue: 'ACL Live at the Moody Theater', venueMeta: 'Music venue · Downtown', opener: 'Jo Alvarez', openerMeta: 'Stand-up · Austin showcase host',
    spots: [['Second St. Social', 'Bar · Downtown'], ['Lamar Late', 'Taqueria · open late'], ['Congress Room', 'Cocktail bar · 5 min walk']] },
  { name: 'Seattle', x: 12, y: 16, score: 64, qr: 5, pr: 15, venue: 'Paramount Theatre', venueMeta: 'Theater · Downtown', opener: 'Ken Nakamura', openerMeta: 'Stand-up · Seattle club regular',
    spots: [['Pine St. Pho', 'Vietnamese · late kitchen'], ['Ninth Ave. Bar', 'Bar · 4 min walk'], ['Capitol Room', 'Cocktail bar · Capitol Hill']] }
];
const SPONSORS = [
  { name: 'Liquid Death', meta: 'Beverage · over-indexes 2.1× with the combined audience' },
  { name: 'Uber Eats', meta: 'Delivery · over-indexes 1.8× with the combined audience' },
  { name: 'Glossier', meta: 'Beauty · over-indexes 1.6× with the combined audience' }
];

const ListRow = ({ name, meta }: { name: string; meta: string }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line py-2.5">
    <div className="flex min-w-40 flex-1 flex-col"><span className="font-medium">{name}</span><span className="text-chip text-mute">{meta}</span></div>
    <SourceBadge />
  </div>
);

export default function Results({ onReplanCity }: { onReplanCity?: (city: string) => void }) {
  const [ci, setCi] = useState(0);
  const [replanning, setReplanning] = useState<number | null>(null);
  const [paper, setPaper] = useState<'letter' | 'a4'>('letter');
  const { copied, copy } = useCopy();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const c = CITIES[ci], dim = replanning !== null && 'opacity-45';

  const useCity = (i: number) => {
    setReplanning(i); onReplanCity?.(CITIES[i].name);
    timer.current = setTimeout(() => { setCi(i); setReplanning(null); }, 1400); // replace with replan completion
  };

  const whyCity = ci === 0 ? `Combined score ${c.score} / 100, the highest of the five metros checked.` : `Chosen by you. Combined score ${c.score} / 100, rank ${c.qr} of 5.`;
  const briefRows = [
    { k: 'City', v: c.name, why: whyCity, src: 'Qloo /v2/insights · filter.type=urn:entity:locality' },
    { k: 'Partner', v: 'Hot Ones', why: '38% audience overlap with Ali Wong fans, affinity 82 / 100.', src: 'Qloo /v2/insights · filter.type=urn:entity:tv_show' },
    { k: 'Format', v: 'Tour stop · live Hot Ones taping before the set', why: 'Fans over-index 2.4× on live comedy over watch parties.', src: 'Qloo /v2/insights · filter.type=urn:tag' },
    { k: 'Venue', v: c.venue, why: `Highest venue affinity in ${c.name} for the combined audience. Capacity, dates and price to confirm with promoter.`, src: 'Qloo /v2/insights · filter.type=urn:entity:place' },
    { k: 'Sponsors', v: SPONSORS.map(s => s.name).join(', '), why: 'Top three brand affinities for the combined audience.', src: 'Qloo /v2/insights · filter.type=urn:entity:brand' }
  ];
  const briefText = `Takeover brief · Ali Wong × Hot Ones, ${c.name}\n\n` + briefRows.map(b => `${b.k}: ${b.v}\n${b.why}\nSource: ${b.src}`).join('\n\n');
  const emails = [
    { key: 'partner', to: 'Hot Ones partnerships team', subject: `Ali Wong × Hot Ones · live taping, ${c.name}`,
      body: ['Hi team, 38% of Ali Wong’s audience also follows Hot Ones, the highest overlap we found for her.',
        `We’d like to open an Ali Wong night at ${c.venue} in ${c.name} with a live Hot Ones taping. Dates are still open.`,
        'Could we get 20 minutes next week to walk through the brief?'] },
    { key: 'venue', to: `${c.venue} booking team`, subject: `Hold request · Ali Wong with Hot Ones, ${c.name}`,
      body: [`Hi, we’re planning a one-night Ali Wong show with a live Hot Ones taping and would like ${c.venue} to host it.`,
        'Could you share open dates over the next six months, seated capacity for a taping setup, and rental terms?',
        'Happy to send the full brief.'] }
  ];

  return (
    <Page max="max-w-[1040px]">
      <AppHeader context="Ali Wong × Hot Ones · Results" />

      {/* 01 City */}
      <Panel className="gap-[18px] print:hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MonoLabel>01 · City</MonoLabel><SourceBadge>Qloo signal · urn:entity:locality</SourceBadge>
        </div>
        <h2 className="t-display m-0 text-[clamp(28px,4vw,40px)] leading-[0.92]">{c.name}</h2>
        <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]">
          <div className="flex flex-col gap-3">
            <DotMap aspect="aspect-[16/10]" points={CITIES.map((x, i) => ({
              name: x.name, score: x.score, x: 12 + x.x * 0.76, y: x.y, size: Math.round(10 + (x.score - 50) * 0.55),
              tone: i === ci ? 'acc' : x.score >= 75 ? 'mute' : 'line', ring: i === ci }))} />
            <Legend items={[{ tone: 'acc', label: 'Chosen city' }, { tone: 'mute', label: 'Score 75+' }, { tone: 'line', label: 'Score 50–74' }]} />
            <p className="m-0 text-chip text-mute [text-wrap:pretty]">Combined score, 0–100: how strongly Ali Wong fans and Hot Ones fans over-index together in a metro compared with the US average. 50 is average. Dot size follows the score.</p>
          </div>
          <div className="flex flex-col">
            {CITIES.map((x, i) => (
              <div key={x.name} className="grid grid-cols-[2em_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 border-b border-line py-2.5">
                <span className="tabular font-mono text-[11px] text-mute">{String(i + 1).padStart(2, '0')}</span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="font-medium">{x.name}</span>
                  <ScoreBar value={x.score} fill={i === ci ? 'acc' : 'mute'} className="gap-2" />
                </div>
                {i === ci
                  ? <span className="px-1.5 font-mono text-label uppercase tracking-[0.06em] text-acc-text">Chosen</span>
                  : <Button variant="pick" onClick={() => useCity(i)}>Use this city</Button>}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <MonoLabel>With Qloo rank vs population rank</MonoLabel>
          <div className="max-w-[520px]">
            <DataTable columns={['City', 'With Qloo', 'Population']} template="minmax(0,1fr) 7em 7em"
              rows={CITIES.map(x => [<span>{x.name}</span>, <Num top={x.qr === 1}>#{x.qr}</Num>, <Num mute>#{x.pr}</Num>])} />
          </div>
        </div>
      </Panel>

      {replanning !== null && <div className="print:hidden"><Banner tone="info">Replanning room, brief and outreach for {CITIES[replanning].name}…</Banner></div>}

      {/* 02 Room & sponsors */}
      <Panel className={cx('gap-[18px] transition-opacity duration-[250ms] print:hidden', dim)}>
        <MonoLabel>02 · Room &amp; sponsors</MonoLabel>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
          <EntityCard role="Venue" name={c.venue} meta={`${c.name} · ${c.venueMeta}`} badges={<>
            <SourceBadge />
            <ConfirmPill>Capacity · to confirm with promoter</ConfirmPill>
            <ConfirmPill>Dates · to confirm with promoter</ConfirmPill>
            <ConfirmPill>Price · to confirm with promoter</ConfirmPill>
          </>} />
          <EntityCard role="Local opener" name={c.opener} meta={c.openerMeta} badges={<><SourceBadge /><ConfirmPill>Dates · to confirm with promoter</ConfirmPill></>} />
        </div>
        <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
          <div className="flex flex-col gap-2"><MonoLabel>After-show spots</MonoLabel>{c.spots.map(([n, m]) => <ListRow key={n} name={n} meta={m} />)}</div>
          <div className="flex flex-col gap-2"><MonoLabel>Sponsors</MonoLabel>{SPONSORS.map(s => <ListRow key={s.name} {...s} />)}</div>
        </div>
      </Panel>

      {/* 03 Brief — the only thing that prints */}
      <section id="brief" className={cx('flex flex-col gap-3 transition-opacity duration-[250ms]', dim)}>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <MonoLabel className="mr-auto">03 · The brief</MonoLabel>
          <Segmented mono value={paper} onChange={setPaper} options={[{ value: 'letter', label: 'Letter' }, { value: 'a4', label: 'A4' }]} />
          <Button variant="primary" onClick={() => window.print()}>Download PDF</Button>
          <Button onClick={() => copy('brief', briefText)}>{copied === 'brief' ? 'Copied' : 'Copy as text'}</Button>
          <Button onClick={() => copy('link', location.href.split('#')[0] + '#brief')}>{copied === 'link' ? 'Copied' : 'Copy link'}</Button>
        </div>
        <div className={cx('box-border flex w-full max-w-[680px] flex-col gap-[18px] self-center rounded-badge bg-paper p-[clamp(22px,6%,48px)] text-paper-ink',
          paper === 'a4' ? 'aspect-[210/297]' : 'aspect-[8.5/11]', 'print:aspect-auto print:max-w-none print:border-0 print:p-0 print:shadow-none')}>
          <div className="flex justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute"><span>Takeover brief</span><span>24 Oct 2026</span></div>
          <div className="t-display text-[clamp(22px,4vw,34px)] leading-[0.95] [text-wrap:balance]">Ali Wong × Hot Ones, {c.name}</div>
          <div className="flex flex-col">
            {briefRows.map(b => (
              <div key={b.k} className="grid grid-cols-[minmax(0,6.5em)_minmax(0,1fr)] gap-x-3.5 gap-y-1 border-t border-paper-line py-2.5">
                <span className="pt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">{b.k}</span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-medium">{b.v}</span>
                  <span className="text-[11.5px] text-n-800 [text-wrap:pretty]">{b.why}</span>
                  <span className="font-mono text-[10px] text-paper-mute [overflow-wrap:anywhere]">◆ {b.src}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-auto border-t border-paper-line pt-2.5 text-[10.5px] text-paper-mute">Capacity, dates and price to confirm with promoter. Every pick is backed by Qloo taste data.</div>
        </div>
      </section>

      {/* 04 Outreach */}
      <section className={cx('flex flex-col gap-3 transition-opacity duration-[250ms] print:hidden', dim)}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MonoLabel>04 · Outreach</MonoLabel>
          <div className="text-chip text-mute">Drafts only. Takeover never sends email.</div>
        </div>
        <div className="grid items-start gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
          {emails.map(m => (
            <EmailCard key={m.key} to={m.to} subject={m.subject} body={m.body} copied={copied === m.key}
              onCopy={() => copy(m.key, `To: ${m.to}\nSubject: ${m.subject}\n\n${m.body.join('\n\n')}`)}
              mailto={`mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body.join('\n\n'))}`} />
          ))}
        </div>
      </section>
    </Page>
  );
}
