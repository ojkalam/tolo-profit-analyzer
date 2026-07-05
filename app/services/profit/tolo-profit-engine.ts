// ToloProfitEngine — the ONLY place profit formulas live (CLAUDE.md §5).
//
// Everything in this module is pure: no Prisma, no network, no clock reads.
// Callers fetch data and pass it in; the engine computes. All money values
// are integer cents; all rates are basis points.
//
//   netRevenue = grossSales − discounts − refunds
//   totalCosts = cogs + shippingCost + transactionFees + allocatedAdSpend
//   netProfit  = netRevenue − totalCosts
//   margin     = netProfit / netRevenue

import { toloApportionCents } from "./tolo-money";

// ---------------------------------------------------------------------------
// COGS resolution — order-time effective cost from history
// ---------------------------------------------------------------------------

export interface ToloCostHistoryEntry {
  costCents: number;
  effectiveFrom: Date;
}

/**
 * Cost effective at `at`: the newest history entry with
 * `effectiveFrom <= at`. Returns null when no cost applies (missing COGS is
 * flagged, never silently zero — CLAUDE.md §5 rule 5).
 */
export function toloResolveCogsAt(
  history: ToloCostHistoryEntry[],
  at: Date,
): number | null {
  let best: ToloCostHistoryEntry | null = null;
  for (const entry of history) {
    if (entry.effectiveFrom.getTime() > at.getTime()) continue;
    if (!best || entry.effectiveFrom.getTime() > best.effectiveFrom.getTime()) {
      best = entry;
    }
  }
  return best ? best.costCents : null;
}

export interface ToloLineCogs {
  cogsCents: number | null;
  cogsMissing: boolean;
}

/** Per-line COGS: unit cost at order time × quantity. */
export function toloResolveLineCogs(
  history: ToloCostHistoryEntry[],
  quantity: number,
  at: Date,
): ToloLineCogs {
  const unit = toloResolveCogsAt(history, at);
  if (unit == null) {
    return { cogsCents: null, cogsMissing: true };
  }
  return { cogsCents: unit * quantity, cogsMissing: false };
}

// ---------------------------------------------------------------------------
// ToloShippingCostResolver — rule-based shipping cost
// ---------------------------------------------------------------------------

export type ToloShippingRuleKind =
  | "flat_order"
  | "per_item"
  | "weight_band"
  | "zone";

export interface ToloShippingRuleInput {
  id: string;
  kind: ToloShippingRuleKind;
  /** Kind-specific config; see resolver cases for shapes. */
  config: unknown;
  priority: number;
  active: boolean;
}

export interface ToloShippingOrderContext {
  itemCount: number;
  totalWeightGrams: number;
  countryCode: string | null;
}

interface ToloWeightBand {
  maxGrams: number | null; // null = catch-all band
  amountCents: number;
}

interface ToloZone {
  countries: string[];
  amountCents: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Resolve shipping cost: active rules in priority order (lowest first);
 * the first rule that yields a cost wins. No matching rule → 0 cents.
 */
export function toloResolveShippingCost(
  rules: ToloShippingRuleInput[],
  ctx: ToloShippingOrderContext,
): { costCents: number; ruleId: string | null } {
  const ordered = rules
    .filter((rule) => rule.active)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of ordered) {
    const config = asRecord(rule.config);
    switch (rule.kind) {
      case "flat_order": {
        const amount = Number(config.amountCents);
        if (Number.isFinite(amount)) {
          return { costCents: Math.trunc(amount), ruleId: rule.id };
        }
        break;
      }
      case "per_item": {
        const amount = Number(config.amountCents);
        if (Number.isFinite(amount)) {
          return {
            costCents: Math.trunc(amount) * Math.max(0, ctx.itemCount),
            ruleId: rule.id,
          };
        }
        break;
      }
      case "weight_band": {
        const bands = Array.isArray(config.bands)
          ? (config.bands as ToloWeightBand[])
          : [];
        const sorted = [...bands].sort(
          (a, b) =>
            (a.maxGrams ?? Number.MAX_SAFE_INTEGER) -
            (b.maxGrams ?? Number.MAX_SAFE_INTEGER),
        );
        for (const band of sorted) {
          if (
            band.maxGrams == null ||
            ctx.totalWeightGrams <= band.maxGrams
          ) {
            return {
              costCents: Math.trunc(Number(band.amountCents) || 0),
              ruleId: rule.id,
            };
          }
        }
        break; // no band matched — fall through to next rule
      }
      case "zone": {
        const zones = Array.isArray(config.zones)
          ? (config.zones as ToloZone[])
          : [];
        if (ctx.countryCode) {
          for (const zone of zones) {
            if (
              Array.isArray(zone.countries) &&
              zone.countries.includes(ctx.countryCode)
            ) {
              return {
                costCents: Math.trunc(Number(zone.amountCents) || 0),
                ruleId: rule.id,
              };
            }
          }
        }
        const fallback = config.defaultCents;
        if (fallback != null && Number.isFinite(Number(fallback))) {
          return { costCents: Math.trunc(Number(fallback)), ruleId: rule.id };
        }
        break;
      }
    }
  }
  return { costCents: 0, ruleId: null };
}

// ---------------------------------------------------------------------------
// Transaction fees
// ---------------------------------------------------------------------------

export interface ToloFeeConfig {
  feeRateBps: number;
  feeFixedCents: number;
}

/**
 * Estimated gateway fee on the amount actually charged
 * (net item revenue + shipping charged). Zero when nothing was charged.
 */
export function toloComputeFeeCents(
  chargedCents: number,
  config: ToloFeeConfig,
): number {
  if (chargedCents <= 0) return 0;
  return (
    Math.round((chargedCents * config.feeRateBps) / 10_000) +
    config.feeFixedCents
  );
}

// ---------------------------------------------------------------------------
// Profit + margin
// ---------------------------------------------------------------------------

export interface ToloProfitInput {
  grossCents: number;
  discountCents: number;
  refundCents: number;
  cogsCents: number;
  shippingCostCents: number;
  feeCents: number;
  adSpendCents: number;
}

export interface ToloProfitResult {
  netRevenueCents: number;
  totalCostCents: number;
  netProfitCents: number;
  marginBps: number;
}

export function toloComputeProfit(input: ToloProfitInput): ToloProfitResult {
  const netRevenueCents =
    input.grossCents - input.discountCents - input.refundCents;
  const totalCostCents =
    input.cogsCents +
    input.shippingCostCents +
    input.feeCents +
    input.adSpendCents;
  const netProfitCents = netRevenueCents - totalCostCents;
  const marginBps =
    netRevenueCents > 0
      ? Math.round((netProfitCents * 10_000) / netRevenueCents)
      : 0;
  return { netRevenueCents, totalCostCents, netProfitCents, marginBps };
}

// ---------------------------------------------------------------------------
// Ad-spend allocation — shop-level daily spend split by revenue share
// ---------------------------------------------------------------------------

export interface ToloProductRevenue {
  productId: string;
  revenueCents: number;
}

/** Allocate a day's ad spend across products proportional to revenue. */
export function toloAllocateAdSpend(
  adSpendCents: number,
  products: ToloProductRevenue[],
): Map<string, number> {
  const allocation = new Map<string, number>();
  const weights = products.map((p) => Math.max(0, p.revenueCents));
  const split = toloApportionCents(adSpendCents, weights);
  products.forEach((p, i) => {
    allocation.set(p.productId, (allocation.get(p.productId) ?? 0) + split[i]);
  });
  return allocation;
}

// ---------------------------------------------------------------------------
// Daily rollup — one shop-local day of orders → daily + per-product totals
// ---------------------------------------------------------------------------

export interface ToloRollupLine {
  productId: string | null;
  quantity: number;
  /** Line revenue after all allocated discounts. */
  revenueCents: number;
  discountCents: number;
  refundedQuantity: number;
  refundedCents: number;
  cogsCents: number | null;
  cogsMissing: boolean;
}

export interface ToloRollupOrder {
  grossCents: number;
  discountCents: number;
  refundCents: number;
  feeCents: number;
  shippingCostCents: number;
  lines: ToloRollupLine[];
}

export interface ToloDailyTotals {
  grossCents: number;
  discountCents: number;
  refundCents: number;
  cogsCents: number;
  shippingCostCents: number;
  feeCents: number;
  adSpendCents: number;
  netRevenueCents: number;
  netProfitCents: number;
  marginBps: number;
  ordersCount: number;
  unitsSold: number;
  cogsMissingCents: number;
}

export interface ToloProductDailyTotals {
  productId: string;
  grossCents: number;
  discountCents: number;
  refundCents: number;
  cogsCents: number;
  shippingCostCents: number;
  feeCents: number;
  adSpendCents: number;
  netRevenueCents: number;
  netProfitCents: number;
  marginBps: number;
  unitsSold: number;
  refundedUnits: number;
  cogsMissing: boolean;
}

const TOLO_UNATTRIBUTED = "tolo:unattributed";

/**
 * Aggregate one day of orders into shop-level and per-product totals.
 * Order-level costs (fees, shipping) are apportioned to lines by revenue;
 * the day's ad spend is allocated across products by revenue share.
 */
export function toloRollupDay(
  orders: ToloRollupOrder[],
  adSpendCents: number,
): { daily: ToloDailyTotals; products: ToloProductDailyTotals[] } {
  interface Accumulator {
    gross: number;
    discount: number;
    refund: number;
    cogs: number;
    shipping: number;
    fee: number;
    units: number;
    refundedUnits: number;
    cogsMissing: boolean;
  }
  const perProduct = new Map<string, Accumulator>();
  const acc = (productId: string): Accumulator => {
    let entry = perProduct.get(productId);
    if (!entry) {
      entry = {
        gross: 0,
        discount: 0,
        refund: 0,
        cogs: 0,
        shipping: 0,
        fee: 0,
        units: 0,
        refundedUnits: 0,
        cogsMissing: false,
      };
      perProduct.set(productId, entry);
    }
    return entry;
  };

  let cogsMissingCents = 0;
  let unitsSold = 0;

  for (const order of orders) {
    const lineWeights = order.lines.map((line) =>
      Math.max(0, line.revenueCents),
    );
    const feeSplit = toloApportionCents(order.feeCents, lineWeights);
    const shippingSplit = toloApportionCents(
      order.shippingCostCents,
      lineWeights,
    );

    order.lines.forEach((line, i) => {
      const productId = line.productId ?? TOLO_UNATTRIBUTED;
      const entry = acc(productId);
      entry.gross += line.revenueCents + line.discountCents;
      entry.discount += line.discountCents;
      entry.refund += line.refundedCents;
      entry.fee += feeSplit[i];
      entry.shipping += shippingSplit[i];
      entry.units += line.quantity;
      entry.refundedUnits += line.refundedQuantity;
      unitsSold += line.quantity;
      if (line.cogsMissing || line.cogsCents == null) {
        entry.cogsMissing = true;
        cogsMissingCents += line.revenueCents;
      } else {
        entry.cogs += line.cogsCents;
      }
    });
  }

  // Ad spend by product revenue share (net of refunds).
  const productRevenues: ToloProductRevenue[] = [...perProduct.entries()].map(
    ([productId, entry]) => ({
      productId,
      revenueCents: entry.gross - entry.discount - entry.refund,
    }),
  );
  const adSplit = toloAllocateAdSpend(adSpendCents, productRevenues);

  const products: ToloProductDailyTotals[] = [...perProduct.entries()].map(
    ([productId, entry]) => {
      const allocatedAd = adSplit.get(productId) ?? 0;
      const profit = toloComputeProfit({
        grossCents: entry.gross,
        discountCents: entry.discount,
        refundCents: entry.refund,
        cogsCents: entry.cogs,
        shippingCostCents: entry.shipping,
        feeCents: entry.fee,
        adSpendCents: allocatedAd,
      });
      return {
        productId,
        grossCents: entry.gross,
        discountCents: entry.discount,
        refundCents: entry.refund,
        cogsCents: entry.cogs,
        shippingCostCents: entry.shipping,
        feeCents: entry.fee,
        adSpendCents: allocatedAd,
        netRevenueCents: profit.netRevenueCents,
        netProfitCents: profit.netProfitCents,
        marginBps: profit.marginBps,
        unitsSold: entry.units,
        refundedUnits: entry.refundedUnits,
        cogsMissing: entry.cogsMissing,
      };
    },
  );

  const grossCents = orders.reduce((sum, o) => sum + o.grossCents, 0);
  const discountCents = orders.reduce((sum, o) => sum + o.discountCents, 0);
  const refundCents = orders.reduce((sum, o) => sum + o.refundCents, 0);
  const feeCents = orders.reduce((sum, o) => sum + o.feeCents, 0);
  const shippingCostCents = orders.reduce(
    (sum, o) => sum + o.shippingCostCents,
    0,
  );
  const cogsCents = products.reduce((sum, p) => sum + p.cogsCents, 0);

  const dayProfit = toloComputeProfit({
    grossCents,
    discountCents,
    refundCents,
    cogsCents,
    shippingCostCents,
    feeCents,
    adSpendCents,
  });

  return {
    daily: {
      grossCents,
      discountCents,
      refundCents,
      cogsCents,
      shippingCostCents,
      feeCents,
      adSpendCents,
      netRevenueCents: dayProfit.netRevenueCents,
      netProfitCents: dayProfit.netProfitCents,
      marginBps: dayProfit.marginBps,
      ordersCount: orders.length,
      unitsSold,
      cogsMissingCents,
    },
    products,
  };
}

// ---------------------------------------------------------------------------
// Anomaly detection — sudden margin shifts without a configured rule
// ---------------------------------------------------------------------------

export interface ToloAnomalyResult {
  isAnomaly: boolean;
  latestBps: number;
  meanBps: number;
  stdDevBps: number;
  /** Signed z-score of the latest point against the baseline window. */
  zScore: number;
}

/**
 * Flag the latest day's margin as anomalous when it deviates from the baseline
 * (earlier days) by more than `zThreshold` standard deviations AND the absolute
 * gap clears `minGapBps` (so tiny, noisy swings don't fire). Needs at least 4
 * baseline points to have a meaningful distribution.
 */
export function toloDetectMarginAnomaly(
  marginSeriesBps: number[],
  zThreshold = 2,
  minGapBps = 500,
): ToloAnomalyResult {
  const none: ToloAnomalyResult = {
    isAnomaly: false,
    latestBps: 0,
    meanBps: 0,
    stdDevBps: 0,
    zScore: 0,
  };
  if (marginSeriesBps.length < 5) return none;

  const latestBps = marginSeriesBps[marginSeriesBps.length - 1];
  const baseline = marginSeriesBps.slice(0, -1);
  const meanBps = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance =
    baseline.reduce((sum, v) => sum + (v - meanBps) ** 2, 0) / baseline.length;
  const stdDevBps = Math.sqrt(variance);

  if (stdDevBps === 0) {
    // Flat baseline: any gap beyond minGapBps is an anomaly.
    const gap = Math.abs(latestBps - meanBps);
    return {
      isAnomaly: gap >= minGapBps,
      latestBps,
      meanBps,
      stdDevBps,
      zScore: gap >= minGapBps ? (latestBps < meanBps ? -Infinity : Infinity) : 0,
    };
  }

  const zScore = (latestBps - meanBps) / stdDevBps;
  const isAnomaly =
    Math.abs(zScore) >= zThreshold &&
    Math.abs(latestBps - meanBps) >= minGapBps;
  return { isAnomaly, latestBps, meanBps, stdDevBps, zScore };
}

export { TOLO_UNATTRIBUTED };
