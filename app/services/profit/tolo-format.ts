// Client-safe re-exports of the pure money formatters, so UI components never
// reach into a *.server module (which would pull server code into the bundle).
export {
  toloFormatBps,
  toloFormatCents,
  toloDecimalToCents,
} from "./tolo-money";

/** Signed profit tone for badges/text: positive = success, negative = critical. */
export function toloProfitTone(
  cents: number,
): "success" | "critical" | "neutral" {
  if (cents > 0) return "success";
  if (cents < 0) return "critical";
  return "neutral";
}

/** Compare two totals and return a percent-change label vs previous. */
export function toloDeltaLabel(current: number, previous: number): string {
  if (previous === 0) {
    if (current === 0) return "—";
    return current > 0 ? "▲ new" : "▼ new";
  }
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
  return `${arrow} ${Math.abs(pct)}% vs prev`;
}
