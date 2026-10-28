import type { CallRecord } from "@/lib/roster/types";

/** The Qloo requests behind a number, as the run's step cards show them. */
export function Calls({ calls }: { calls: CallRecord[] }) {
  if (!calls.length) return <span className="text-mute">Qloo requests were not recorded for this result; refresh to record them.</span>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {calls.map((c, i) => (
        <li key={i} className="flex flex-col font-mono text-label [overflow-wrap:anywhere]">
          <span className="text-ink">
            GET {c.endpoint}
            {c.cached ? " · cached" : ""}
          </span>
          {Object.entries(c.params).map(([k, v]) => (
            <span key={k} className="text-mute">
              {k} = {v}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}
