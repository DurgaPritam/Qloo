/** When watches run: pure date arithmetic, safe to import anywhere. */

/** Snapshots are weekly: Monday 07:00 in the workspace's time zone. The job ticks hourly and takes whatever is due. */
export const WATCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const FIRST_SNAPSHOT_NOTE = "First snapshot taken; changes appear next week.";
export const WATCH_HOUR = 7;

/** Minutes the zone is ahead of UTC at `at`. */
function zoneOffset(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  );
  return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - at.getTime()) / 60_000;
}

/** The UTC instant of a wall-clock time in a zone (twice, so a DST change in between is handled). */
function zonedInstant(y: number, m: number, d: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(y, m, d, hour);
  const first = guess - zoneOffset(new Date(guess), timeZone) * 60_000;
  return new Date(guess - zoneOffset(new Date(first), timeZone) * 60_000);
}

export const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * When an item is next due: the next Monday at 07:00 in the workspace's time zone (UTC when none
 * is set), but at least four days away, so two snapshots are never days apart.
 */
export function nextCheck(now: Date, timeZone: string | null = null): Date {
  const tz = timeZone && isTimeZone(timeZone) ? timeZone : "UTC";
  const local = new Date(now.getTime() + zoneOffset(now, tz) * 60_000);
  const day = local.getUTCDay();
  const ahead = (8 - day) % 7 || 7;
  const monday = zonedInstant(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + ahead, WATCH_HOUR, tz);
  if (monday.getTime() - now.getTime() >= 4 * 24 * 60 * 60 * 1000) return monday;
  return zonedInstant(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + ahead + 7, WATCH_HOUR, tz);
}


/** The local weekday (0 Sunday … 6 Saturday), hour and date in a time zone (UTC when none). */
export function localParts(now: Date, timeZone: string | null): { weekday: number; hour: number; date: string } {
  const tz = timeZone && isTimeZone(timeZone) ? timeZone : "UTC";
  const local = new Date(now.getTime() + zoneOffset(now, tz) * 60_000);
  return { weekday: local.getUTCDay(), hour: local.getUTCHours(), date: local.toISOString().slice(0, 10) };
}

/** True during the workspace's Monday 07:xx: the only hour the hourly tick runs its weekly watch. */
export function isWatchHour(now: Date, timeZone: string | null): boolean {
  const p = localParts(now, timeZone);
  return p.weekday === 1 && p.hour === WATCH_HOUR;
}

/** The week a run belongs to: the local date of that week's Monday (YYYY-MM-DD). */
export function watchWeek(now: Date, timeZone: string | null): string {
  const p = localParts(now, timeZone);
  const back = (p.weekday + 6) % 7;
  const d = new Date(`${p.date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
