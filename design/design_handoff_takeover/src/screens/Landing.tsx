import { useState } from 'react';
import { Page, AppHeader, InputBar, Chip, MonoLabel, SourceBadge } from '../components/ui';

const EXAMPLES = [
  { kind: 'Comedian', name: 'Ali Wong' },
  { kind: 'Music artist', name: 'Fred again..' },
  { kind: 'Film', name: 'Dune: Part Two' },
  { kind: 'Sports team', name: 'Golden State Warriors' }
];
const STEPS = [
  { n: '01', title: 'Crossover', body: 'Find the artists, brands and venues their audience also rates highly.' },
  { n: '02', title: 'City', body: 'Rank cities by how strongly that overlap shows up in each one.' },
  { n: '03', title: 'Plan & brief', body: 'Get a takeover plan and a partner brief ready to send.' }
];

export default function Landing({ onPlan }: { onPlan?: (query: string) => void }) {
  const [query, setQuery] = useState('');
  return (
    <Page>
      <AppHeader right={<div className="font-mono text-label uppercase tracking-[0.08em] text-mute">Powered by Qloo</div>} />

      <section className="flex flex-col gap-[22px] pb-14 pt-[min(14vh,112px)]">
        <h1 className="t-display t-display-headline m-0 max-w-[16ch]">Pick a talent. Find the city where their audience overlaps. Get the plan.</h1>
        <InputBar value={query} onChange={setQuery} onSubmit={() => onPlan?.(query)} placeholder="Plan a takeover for…" />
        <div className="flex flex-wrap items-center gap-2">
          {EXAMPLES.map(e => <Chip key={e.name} kind={e.kind} label={e.name} onClick={() => setQuery(e.name)} />)}
        </div>
      </section>

      <section className="flex flex-col gap-[18px] border-t border border-line pb-[22px] pt-[18px]">
        <MonoLabel>How it works</MonoLabel>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          {STEPS.map(s => (
            <div key={s.n} className="flex flex-col gap-1.5 rounded-md bg-surf p-panel">
              <div className="font-mono text-label uppercase tracking-[0.08em] text-acc-text">Step {s.n}</div>
              <div className="text-body font-medium">{s.title}</div>
              <div className="text-chip text-mute [text-wrap:pretty]">{s.body}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <SourceBadge />
          <p className="m-0 text-body [text-wrap:pretty]">Every pick is backed by Qloo taste data. Nothing Qloo doesn't know is invented.</p>
        </div>
      </section>
    </Page>
  );
}
