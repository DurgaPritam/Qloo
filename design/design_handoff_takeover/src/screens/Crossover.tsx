import { useEffect, useRef, useState } from 'react';
import { Page, AppHeader, Segmented, Banner, EntityCard, SourceBadge, NoSourceBadge, ConfirmPill, ScoreBar, MonoLabel, Button, cx } from '../components/ui';

type View = 'qloo' | 'llm';
const FAN = { name: 'Ali Wong', meta: '25–34 · LA, New York, Chicago · stand-up specials, food media' };
const PARTNERS = [
  { name: 'Hot Ones', meta: 'YouTube series · Los Angeles · 38% audience overlap', score: 82, format: 'Tour stop · live Hot Ones taping before the set',
    why: 'Both audiences over-index on spicy-food content and long-form comedy interviews.', signal: '2 shared tags' },
  { name: 'Bon Appétit', meta: 'Food media · New York · 27% audience overlap', score: 64, format: 'Tour stop · test-kitchen special filmed on the day',
    why: 'Both audiences over-index on home-cooking video and Asian-American food culture.', signal: '2 shared tags' },
  { name: 'SmartLess', meta: 'Podcast · Los Angeles · 24% audience overlap', score: 61, format: 'Tour stop · live podcast recording after the set',
    why: 'Both audiences over-index on comedy podcasts and celebrity interview formats.', signal: '2 shared tags' }
];
const LLM = {
  fan: { name: 'Comedy fans', meta: 'Ages 18–45 · major US cities' },
  partner: { name: 'A popular podcast', meta: 'Entertainment · nationwide' },
  format: 'Comedy show', why: 'Both are popular with people who enjoy comedy and entertainment.',
  others: [{ name: 'A streaming service', meta: 'Entertainment · nationwide' }, { name: 'A beverage brand', meta: 'Lifestyle · nationwide' }]
};
/* LLM-only view neutralises accent tokens locally so nothing reads as "sourced". */
const LLM_VARS = { '--acc': 'var(--line)', '--acc-line': 'var(--line)', '--acc-text': 'var(--mute)', '--acc-soft': 'var(--track)' } as React.CSSProperties;

export default function Crossover({ onReplan }: { onReplan?: (partner: string) => Promise<void> | void }) {
  const [view, setView] = useState<View>('qloo');
  const [chosen, setChosen] = useState(0);
  const [replanning, setReplanning] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const llm = view === 'llm', p = PARTNERS[chosen];

  const use = (i: number) => {
    setReplanning(i);
    onReplan?.(PARTNERS[i].name);
    timer.current = setTimeout(() => { setChosen(i); setReplanning(null); }, 1400); // replace with replan completion
  };
  const heroStatus = llm ? 'Unsourced guess' : replanning !== null ? `Replanning with ${PARTNERS[replanning].name}…` : `Score ${p.score} / 100`;

  return (
    <Page max="max-w-[960px]">
      <AppHeader context="Ali Wong · Crossover" right={
        <Segmented<View> value={view} onChange={setView} options={[{ value: 'qloo', label: 'With Qloo' }, { value: 'llm', label: 'LLM only' }]} />
      } />

      {llm && <Banner tone="neutral">LLM only: what a plain chatbot guessed with no taste data. Nothing below is sourced or scored.</Banner>}

      <section style={llm ? LLM_VARS : undefined}>
        <div className={cx('flex flex-col gap-[18px] rounded-lg bg-surf p-panel transition-opacity duration-[250ms]', replanning !== null && !llm && 'opacity-45')}>
          <div className="flex justify-between gap-3 font-mono text-label uppercase tracking-[0.08em] text-mute">
            <span>Chosen pair</span><span>{heroStatus}</span>
          </div>

          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
            {llm ? <>
              <EntityCard role="Fanbase" size={32} {...LLM.fan} badges={<NoSourceBadge />} />
              <EntityCard role="Partner" size={32} {...LLM.partner} badges={<NoSourceBadge />} />
            </> : <>
              <EntityCard role="Fanbase" size={32} {...FAN} badges={<SourceBadge />} />
              <EntityCard role="Partner" size={32} name={p.name} meta={p.meta} badges={<><SourceBadge /><ConfirmPill>To confirm · availability</ConfirmPill></>} />
            </>}
          </div>

          <div className="flex flex-col gap-2">
            <MonoLabel>Shared audience</MonoLabel>
            <ScoreBar value={llm ? 0 : p.score} label={llm ? 'Not measured' : undefined} />
          </div>

          <div className="grid grid-cols-[minmax(0,8em)_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t border-line pt-3.5">
            <span className="pt-0.5 font-mono text-label uppercase tracking-[0.08em] text-mute">Format</span>
            <span className="font-medium">{llm ? LLM.format : p.format}</span>
            <span className="pt-0.5 font-mono text-label uppercase tracking-[0.08em] text-mute">Why this pair</span>
            <div className="flex flex-col items-start gap-1.5">
              <span className="[text-wrap:pretty]">{llm ? LLM.why : p.why}</span>
              {llm ? <NoSourceBadge /> : <SourceBadge>Qloo signal · {p.signal}</SourceBadge>}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <MonoLabel className="pb-1">Also shortlisted</MonoLabel>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
          {(llm
            ? LLM.others.map(o => ({ ...o, score: null as number | null, i: -1 }))
            : PARTNERS.map((o, i) => ({ ...o, i })).filter(o => o.i !== chosen)
          ).map(o => (
            <div key={o.name} className="flex min-w-0 flex-col gap-2.5 rounded-md bg-surf p-[18px]">
              <div className="flex flex-col gap-1">
                <div className="font-body text-[18px] font-semibold leading-[1.2]">{o.name}</div>
                <div className="text-chip text-mute">{o.meta}</div>
              </div>
              <ScoreBar value={o.score} fill="mute" />
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {llm ? <NoSourceBadge /> : <SourceBadge />}
                <div className="flex-1" />
                {!llm && <Button variant="pick" onClick={() => use(o.i)}>Use this partner</Button>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
