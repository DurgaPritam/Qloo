import { useEffect, useMemo, useState } from 'react';
import {
  Page, AppHeader, Button, MonoLabel, Panel, StepCard, StepData, StepStatus, Sk, OutlineChip,
  Banner, SourceBadge, ConfirmPill, ScoreBar, DataTable, Num, DotMap, Legend, useCopy, cx
} from '../components/ui';

/* In production these come from the agent's event stream. The simulation below reproduces the prototype timing. */
type Scenario = 'fallback' | 'clean' | 'error';
const STEPS = [
  { title: 'Identify fanbase', dur: 1400, live: 'Querying audience demographics…', endpoint: 'GET /v2/insights',
    params: [['filter.type', 'urn:demographics'], ['signal.interests.entities', 'ALI_WONG · e7c1…4f2a']],
    decision: 'Core fans are 25–34 and over-index on stand-up specials and food media.' },
  { title: 'Choose format', dur: 1200, live: 'Scoring live, stream and pop-up formats…', endpoint: 'GET /v2/insights',
    params: [['filter.type', 'urn:tag'], ['filter.tag.types', 'urn:tag:genre:media'], ['signal.interests.entities', 'ALI_WONG']],
    decision: 'Picked a live taping because fans over-index 2.4× on live comedy versus watch parties.' },
  { title: 'Find crossover partners', dur: 2800, branchAt: 1200, live: 'Searching music brands at affinity ≥ 0.70…', live2: 'Retrying with TV and podcasts at ≥ 0.60…',
    endpoint: 'GET /v2/insights',
    params: [['filter.type', 'urn:entity:tv_show, urn:entity:podcast'], ['signal.interests.entities', 'ALI_WONG'], ['filter.affinity.min', '0.60  (was 0.70)'], ['take', '10']],
    cleanParams: [['filter.type', 'urn:entity:tv_show, urn:entity:podcast'], ['signal.interests.entities', 'ALI_WONG'], ['filter.affinity.min', '0.70'], ['take', '10']],
    branch: 'No partner above the threshold, widening the search',
    fallback: 'No music partner cleared the 0.70 affinity threshold, so the agent widened to TV shows and podcasts at 0.60.',
    decision: 'Picked Hot Ones because its 82 / 100 affinity is 18 points above the next option.' },
  { title: 'Pick the city', dur: 1400, live: 'Ranking metros by audience affinity…', endpoint: 'GET /v2/insights',
    params: [['filter.type', 'urn:entity:locality'], ['signal.interests.entities', 'ALI_WONG, HOT_ONES'], ['filter.location.country', 'US']],
    decision: 'Picked Los Angeles because its affinity is 91, twelve points above Chicago.' },
  { title: 'Pick room & sponsors', dur: 1600, live: 'Searching venues and brands in Los Angeles…', endpoint: 'GET /v2/insights',
    params: [['filter.type', 'urn:entity:place, urn:entity:brand'], ['filter.location.query', 'Los Angeles'], ['filter.tags', 'urn:tag:category:theater'], ['signal.interests.entities', 'ALI_WONG, HOT_ONES']],
    error: 'Venue search timed out after 3 retries. Nothing was picked.',
    decision: 'Picked The Wiltern because it has the highest venue affinity in LA for the combined audience.' },
  { title: 'Write the brief', dur: 1800, live: 'Comparing shared taste signals…', endpoint: 'GET /v2/insights/compare',
    params: [['a.signal.interests.entities', 'ALI_WONG'], ['b.signal.interests.entities', 'HOT_ONES'], ['filter.type', 'urn:tag']],
    decision: 'Led with the food-and-comedy angle, the strongest shared tag.' },
  { title: 'Draft outreach', dur: 1400, live: 'Drafting partner email…', endpoint: 'GET /v2/insights',
    params: [['filter.type', 'urn:tag'], ['signal.interests.entities', 'HOT_ONES'], ['take', '5']],
    decision: 'Addressed partnerships with the 38% overlap stat in the first line.' }
] as const;
const START: number[] = []; let acc = 0; STEPS.forEach((s, i) => { START[i] = acc; acc += s.dur; });
const TOTAL = acc, END = STEPS.map((s, i) => START[i] + s.dur);

const EMAIL = {
  subject: 'Ali Wong × Hot Ones · live taping, Los Angeles',
  body: [
    'Hi team, 38% of Ali Wong’s audience also follows Hot Ones, the highest overlap we found for her.',
    'We’re proposing a live Hot Ones taping as the opening set of an Ali Wong night at The Wiltern, with a food partner on site. Dates are still open.',
    'Could we get 20 minutes next week to walk through the brief?'
  ]
};
const CITIES = [['Seattle', 10, 18, 64], ['Los Angeles', 14, 60, 91], ['Austin', 47, 76, 72], ['Chicago', 63, 30, 79], ['Atlanta', 74, 66, 58], ['New York', 87, 28, 77]] as const;
const BRIEF = [
  { k: 'Concept', v: 'A live Hot Ones taping opens an Ali Wong night: hot-sauce interview first, then a 60-minute set.' },
  { k: 'Audience', v: '25–34, Los Angeles metro. Heavy overlap on stand-up specials and food media.' },
  { k: 'Format', v: 'One night at The Wiltern with a food sponsor activation in the lobby. Capacity, dates and price to confirm with promoter.' },
  { k: 'Ask', v: 'Hot Ones to co-produce the taping and co-promote to their channel.' }
];

function useRunSim(scenario: Scenario, speed = 1) {
  const [t, setT] = useState(0);
  const [errored, setErrored] = useState(false);
  const [retried, setRetried] = useState(false);
  useEffect(() => {
    if (t >= TOTAL || errored) return;
    const id = setTimeout(() => {
      const next = t + 100 * speed;
      if (scenario === 'error' && !retried && next >= END[4]) { setT(END[4]); setErrored(true); }
      else setT(Math.min(next, TOTAL));
    }, 100);
    return () => clearTimeout(id);
  }, [t, errored, retried, scenario, speed]);
  const status = (i: number): StepStatus => {
    if (errored && i === 4) return 'error';
    if (errored && i > 4) return 'waiting';
    if (t < START[i]) return 'waiting';
    if (t < END[i]) return 'running';
    return 'fallback' in STEPS[i] && scenario !== 'clean' ? 'fallback' : 'done';
  };
  return {
    t, errored, status,
    replay: () => { setT(0); setErrored(false); setRetried(false); },
    retry: () => { setErrored(false); setRetried(true); setT(START[4]); }
  };
}

export default function Run({ scenario = 'fallback', speed = 1 }: { scenario?: Scenario; speed?: number }) {
  const sim = useRunSim(scenario, speed);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [showLog, setShowLog] = useState(false);
  const { copied, copy } = useCopy();

  const stats = STEPS.map((_, i) => sim.status(i));
  const complete = (i: number) => stats[i] === 'done' || stats[i] === 'fallback';
  const doneCount = stats.filter((_, i) => complete(i)).length;
  const cur = stats.findIndex(s => s === 'running' || s === 'error');
  const statusText = sim.errored ? 'Stopped at step 5' : doneCount === 7 ? 'Complete · 7 / 7' : `Step ${cur + 1} of 7`;
  const currentTitle = sim.errored ? 'Error · ' + STEPS[4].title : doneCount === 7 ? 'Run complete' : STEPS[Math.max(cur, 0)].title;

  const steps: (StepData & { showBranch: boolean })[] = useMemo(() => STEPS.map((s: any, i) => {
    const into = sim.t - START[i], branching = !!s.branch && scenario !== 'clean';
    return {
      n: String(i + 1).padStart(2, '0'), title: s.title, status: stats[i], seconds: (s.dur / 1000).toFixed(1) + 's',
      liveText: branching && into >= s.branchAt ? s.live2 : s.live,
      branch: s.branch, fallbackText: s.fallback, errorText: s.error, decision: s.decision, endpoint: s.endpoint,
      params: (scenario === 'clean' && s.cleanParams) || s.params,
      showBranch: branching && ((stats[i] === 'running' && into >= s.branchAt) || stats[i] === 'fallback')
    };
  }), [sim.t, scenario, stats.join()]);

  const log = (
    <section className="flex flex-col gap-2">
      <div className="flex justify-between pb-1 font-mono text-label uppercase tracking-[0.08em] text-mute">
        <span>Agent log</span><span className="tabular">{doneCount} / 7</span>
      </div>
      {steps.map((s, i) => (
        <StepCard key={s.n} step={s} showBranch={s.showBranch} open={!!open[i]}
          onToggle={() => setOpen(o => ({ ...o, [i]: !o[i] }))} onRetry={sim.retry} />
      ))}
    </section>
  );

  const fill = (v: number) => v >= 90 ? 'acc' : v >= 70 ? 'mute' : 'line';

  return (
    <Page max="max-w-[1280px]">
      <AppHeader context="Run · Ali Wong" right={<>
        <div className="tabular font-mono text-[11px] uppercase tracking-[0.06em] text-mute">{statusText}</div>
        <Button onClick={sim.replay}>Replay</Button>
      </>} />

      {/* Mobile: log collapses into a progress bar */}
      <div className="flex flex-col gap-2.5 rounded-md bg-surf p-4 md:hidden">
        <div className="flex items-baseline gap-2">
          <div className="tabular font-mono text-label uppercase tracking-[0.08em] text-acc-text">{doneCount} / 7</div>
          <div className="min-w-0 flex-1 truncate text-body font-medium">{currentTitle}</div>
          <button type="button" onClick={() => setShowLog(v => !v)} className="cursor-pointer border-0 bg-transparent py-1 font-mono text-label uppercase tracking-[0.06em] text-mute">
            {showLog ? 'Hide log' : 'Show log'}
          </button>
        </div>
        <div className="h-2 overflow-hidden rounded-pill bg-track">
          <div className="h-full rounded-pill bg-acc-line transition-[width] duration-[400ms]" style={{ width: `${(doneCount / 7) * 100}%` }} />
        </div>
      </div>

      <div className="grid items-start gap-[22px] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className={cx(showLog ? 'block' : 'hidden', 'md:block')}>{log}</div>

        <section className="flex min-w-0 flex-col gap-[18px]">
          <div className="flex flex-col gap-2">
            <MonoLabel>Results</MonoLabel>
            <h1 className="t-display m-0 text-[clamp(30px,4.5vw,44px)] leading-[0.92] [text-wrap:balance]">Ali Wong takeover</h1>
            <div className="flex min-h-[22px] flex-wrap items-center gap-2">
              {complete(0) && <OutlineChip>Fans 25–34 · stand-up + food media</OutlineChip>}
              {complete(1) && <OutlineChip>Format · live taping</OutlineChip>}
              {!complete(1) && <Sk.chip />}
            </div>
          </div>

          <Panel>
            <MonoLabel>01 · Crossover partner</MonoLabel>
            {!complete(2) ? <div className="flex flex-col gap-2.5"><Sk.title /><Sk.line /><Sk.bar /></div> : <>
              {scenario !== 'clean' && <Banner tone="warn">Widened search: no music partner cleared 0.70 affinity. Showing TV and podcast partners at 0.60.</Banner>}
              <div className="flex flex-col gap-1.5">
                <div className="t-display text-[28px] leading-none">Hot Ones</div>
                <div className="text-chip text-mute">YouTube series · Los Angeles · 38% audience overlap</div>
                <div className="flex flex-wrap gap-1.5 pt-1"><SourceBadge /><ConfirmPill>To confirm · availability</ConfirmPill></div>
              </div>
              <ScoreBar value={82} />
              <DataTable columns={['Partner', 'Type', 'Affinity']} template="minmax(0,1fr) minmax(0,1fr) 5em" rows={[
                [<span>Hot Ones</span>, <span className="text-mute">YouTube series</span>, <Num top>82</Num>],
                [<span>Bon Appétit</span>, <span className="text-mute">Food media</span>, <Num>64</Num>],
                [<span>SmartLess</span>, <span className="text-mute">Podcast</span>, <Num>61</Num>]
              ]} />
            </>}
          </Panel>

          <Panel>
            <MonoLabel>02 · City</MonoLabel>
            {!complete(3) ? <Sk.map /> : <>
              <DotMap points={CITIES.map(([name, x, y, v]) => ({ name, x: 12 + x * 0.76, y, score: v, size: Math.round(8 + (v - 50) * 0.5), tone: fill(v) }))} />
              <Legend items={[{ tone: 'acc', label: 'Affinity 90+' }, { tone: 'mute', label: '70–89' }, { tone: 'line', label: 'Below 70' }]} />
              <div className="text-body">Los Angeles, 91 / 100. Twelve points above Chicago.</div>
            </>}
          </Panel>

          <Panel>
            <MonoLabel>03 · Room &amp; sponsors</MonoLabel>
            {sim.errored && <Banner tone="err">Venue search timed out. Retry the step from the log to continue.</Banner>}
            {!complete(4) && !sim.errored && <div className="flex flex-col gap-2.5"><Sk.title /><Sk.line /><Sk.block /></div>}
            {complete(4) && (
              <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]">
                <div className="flex flex-col gap-1.5">
                  <div className="t-display text-[28px] leading-none">The Wiltern</div>
                  <div className="text-chip text-mute">Los Angeles · Theater · Koreatown</div>
                  <div className="flex flex-wrap gap-1.5 pt-1"><SourceBadge /><ConfirmPill>Capacity · to confirm with promoter</ConfirmPill><ConfirmPill>Dates · to confirm with promoter</ConfirmPill><ConfirmPill>Price · to confirm with promoter</ConfirmPill></div>
                </div>
                <DataTable columns={['Sponsor', 'Category', 'Affinity']} template="minmax(0,1fr) minmax(0,1fr) 5em" rows={[
                  [<span>Liquid Death</span>, <span className="text-mute">Beverage</span>, <Num top>84</Num>],
                  [<span>Uber Eats</span>, <span className="text-mute">Delivery</span>, <Num>79</Num>],
                  [<span>Glossier</span>, <span className="text-mute">Beauty</span>, <Num>73</Num>]
                ]} />
              </div>
            )}
          </Panel>

          <Panel>
            <MonoLabel>04 · Brief</MonoLabel>
            {!complete(5) ? <div className="flex flex-col gap-2.5"><Sk.title /><Sk.line /><Sk.line /><Sk.lineShort /></div> : <>
              <div className="t-display text-[24px] leading-none [text-wrap:balance]">Ali Wong × Hot Ones: Late Set at The Wiltern</div>
              <div className="flex flex-col">
                {BRIEF.map(b => (
                  <div key={b.k} className="grid grid-cols-[minmax(0,7em)_minmax(0,1fr)] gap-3 border-t border-line py-2.5">
                    <span className="pt-0.5 font-mono text-label uppercase tracking-[0.06em] text-mute">{b.k}</span>
                    <span className="[text-wrap:pretty]">{b.v}</span>
                  </div>
                ))}
              </div>
            </>}
          </Panel>

          <Panel>
            <div className="flex items-center justify-between gap-3">
              <MonoLabel>05 · Outreach</MonoLabel>
              {complete(6) && <Button onClick={() => copy('email', `To: Hot Ones partnerships team\nSubject: ${EMAIL.subject}\n\n${EMAIL.body.join('\n\n')}`)}>
                {copied === 'email' ? 'Copied' : 'Copy email'}</Button>}
            </div>
            {!complete(6) ? <div className="flex flex-col gap-2.5"><Sk.lineShort /><Sk.lineShort /><Sk.block /></div> : <>
              <div className="flex flex-col font-mono text-[11px]">
                <div className="flex gap-2.5 border-b border-line py-1.5"><span className="w-[5em] flex-none text-mute">To</span><span>Hot Ones partnerships team</span></div>
                <div className="flex gap-2.5 border-b border-line py-1.5"><span className="w-[5em] flex-none text-mute">Subject</span><span>{EMAIL.subject}</span></div>
              </div>
              <div className="flex flex-col gap-2.5 text-body [text-wrap:pretty]">{EMAIL.body.map(p => <p key={p} className="m-0">{p}</p>)}</div>
            </>}
          </Panel>
        </section>
      </div>
    </Page>
  );
}
