// Pure date helpers. Day keys are "YYYY-MM-DD" strings in the shop's IANA
// timezone — computed once at ingest so rollups never shift across timezones.

/** Day key for an instant in a given timezone, e.g. "2026-07-05". */
export function toloDayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Current hour (0–23) in a timezone — used for shop-local scheduling. */
export function toloLocalHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number(hour);
}

/** Weekday in a timezone: 1 = Monday … 7 = Sunday (ISO). */
export function toloLocalIsoWeekday(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return order.indexOf(name) + 1;
}

/** Add n days (may be negative) to a day key. */
export function toloAddDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** Inclusive list of day keys from `from` to `to`. */
export function toloEnumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = toloAddDays(cursor, 1);
    if (days.length > 1000) break; // guard against inverted ranges
  }
  return days;
}

/** ISO-8601 week key for a day key, e.g. "2026-W27" — alert dedupe window. */
export function toloWeekKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // ISO week: shift to the Thursday of this week, then count weeks from Jan 1.
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Number of days in a "YYYY-MM" month. */
export function toloDaysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
