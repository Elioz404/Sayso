// Calendar days as "YYYY-MM-DD" strings, for plans and delivery estimates. Day arithmetic happens in UTC
// so it never trips over daylight-saving changes; a day string means the same date everywhere.

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
