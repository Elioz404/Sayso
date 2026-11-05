// Calendar days as "YYYY-MM-DD" strings, for plans, delivery estimates and sales periods. Day arithmetic
// happens on the strings (in UTC), so it never trips over daylight-saving changes; a day string means the
// same date everywhere. Where a day starts depends on the shop's time zone (dayIn, startOfDay).

export type Day = string;

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is not one). */
export function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && addDays(value, 0) === value;
}

export function addDays(day: Day, days: number): Day {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(start: Day, end: Day): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** The day of an ISO timestamp, or of now. */
export function dayOf(at: Date | string = new Date()): Day {
  return (typeof at === 'string' ? new Date(at) : at).toISOString().slice(0, 10);
}

/** An IANA time zone this runtime knows ("America/Los_Angeles"), or undefined. */
export function knownTimeZone(zone: unknown): string | undefined {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return undefined;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

/** How far `zone`'s wall clock is ahead of UTC at instant `t`, in ms (negative west of Greenwich). */
function offsetAt(t: number, zone: string): number {
  let format = zoneFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    zoneFormats.set(zone, format);
  }
  const part = Object.fromEntries(format.formatToParts(new Date(t)).map((p) => [p.type, Number(p.value)]));
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second) - (t - (((t % 1000) + 1000) % 1000));
}

/** The calendar day it is in `zone` at instant `t`. */
export function dayIn(t: number, zone: string): Day {
  return new Date(t + offsetAt(t, zone)).toISOString().slice(0, 10);
}

/** The instant `day` starts in `zone` (its local midnight), daylight-saving changes included. */
export function startOfDay(day: Day, zone: string): number {
  const wall = Date.parse(`${day}T00:00:00Z`);
  const guess = wall - offsetAt(wall, zone);
  return wall - offsetAt(guess, zone);
}

/** Monday 0 ... Sunday 6. */
export function weekdayOf(day: Day): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The first day of the month `months` away from `day`'s month. */
export function monthStart(day: Day, months = 0): Day {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}
