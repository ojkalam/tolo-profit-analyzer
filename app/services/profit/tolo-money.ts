// Money utilities. All money in the app is integer cents; these are the only
// approved conversion points. Floats never carry money values (CLAUDE.md §5).

/**
 * Parse a decimal money string from the Shopify API ("12.34", "12", "12.5")
 * into integer cents using string math — no floating point.
 */
export function toloDecimalToCents(amount: string | null | undefined): number {
  if (amount == null || amount === "") return 0;
  const trimmed = String(amount).trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  if (!/^\d*(\.\d*)?$/.test(unsigned)) {
    throw new Error(`toloDecimalToCents: unparseable amount "${amount}"`);
  }
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const centsPart = (fraction + "00").slice(0, 2);
  // Round half-up on the third fractional digit if present.
  const roundUp = fraction.length > 2 && Number(fraction[2]) >= 5 ? 1 : 0;
  const cents = Number(whole) * 100 + Number(centsPart) + roundUp;
  return negative ? -cents : cents;
}

/** Format integer cents for display — the UI edge only. */
export function toloFormatCents(
  cents: number,
  currency: string,
  locale = "en-US",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

/** Format basis points as a percentage string, e.g. 2534 → "25.3%". */
export function toloFormatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

/**
 * Split `totalCents` across `weights` proportionally with no lost cents:
 * largest-remainder method. Used for ad-spend allocation and discount
 * apportioning. Returns an array aligned with `weights`.
 */
export function toloApportionCents(
  totalCents: number,
  weights: number[],
): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0 || weights.length === 0) {
    return weights.map(() => 0);
  }
  const raw = weights.map((w) => (totalCents * w) / weightSum);
  const floored = raw.map((value) => Math.floor(value));
  let remainder = totalCents - floored.reduce((a, b) => a + b, 0);
  // Distribute leftover cents to the largest fractional parts first.
  const byFraction = raw
    .map((value, i) => ({ i, frac: value - floored[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of byFraction) {
    if (remainder <= 0) break;
    floored[i] += 1;
    remainder -= 1;
  }
  return floored;
}
