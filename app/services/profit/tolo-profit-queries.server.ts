import type { ToloShop } from "@prisma/client";
import prisma from "../../db.server";
import { toloAddDays, toloDayKey } from "../tolo-dates";

export type ToloRangeKey = "today" | "7d" | "30d" | "custom";

export interface ToloDateRange {
  from: string;
  to: string;
}

/** Resolve a range key (or explicit from/to) to shop-local day bounds. */
export function toloResolveRange(
  shop: ToloShop,
  rangeKey: ToloRangeKey,
  custom?: Partial<ToloDateRange>,
): ToloDateRange {
  const today = toloDayKey(new Date(), shop.ianaTimezone);
  switch (rangeKey) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: toloAddDays(today, -6), to: today };
    case "30d":
      return { from: toloAddDays(today, -29), to: today };
    case "custom":
      return {
        from: custom?.from ?? toloAddDays(today, -29),
        to: custom?.to ?? today,
      };
  }
}

/** The previous, equal-length period immediately before a range. */
export function toloPreviousRange(range: ToloDateRange): ToloDateRange {
  const days = Math.max(
    1,
    Math.round(
      (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1,
    ),
  );
  return {
    from: toloAddDays(range.from, -days),
    to: toloAddDays(range.from, -1),
  };
}

export interface ToloProfitTotals {
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

const EMPTY_TOTALS: ToloProfitTotals = {
  grossCents: 0,
  discountCents: 0,
  refundCents: 0,
  cogsCents: 0,
  shippingCostCents: 0,
  feeCents: 0,
  adSpendCents: 0,
  netRevenueCents: 0,
  netProfitCents: 0,
  marginBps: 0,
  ordersCount: 0,
  unitsSold: 0,
  cogsMissingCents: 0,
};

/** Sum the DailyProfit rollup cache across a range. */
export async function toloTotalsForRange(
  shopId: string,
  range: ToloDateRange,
): Promise<ToloProfitTotals> {
  const rows = await prisma.toloDailyProfit.findMany({
    where: { shopId, date: { gte: range.from, lte: range.to } },
  });
  const totals = { ...EMPTY_TOTALS };
  for (const row of rows) {
    totals.grossCents += row.grossCents;
    totals.discountCents += row.discountCents;
    totals.refundCents += row.refundCents;
    totals.cogsCents += row.cogsCents;
    totals.shippingCostCents += row.shippingCostCents;
    totals.feeCents += row.feeCents;
    totals.adSpendCents += row.adSpendCents;
    totals.netRevenueCents += row.netRevenueCents;
    totals.netProfitCents += row.netProfitCents;
    totals.ordersCount += row.ordersCount;
    totals.unitsSold += row.unitsSold;
    totals.cogsMissingCents += row.cogsMissingCents;
  }
  totals.marginBps =
    totals.netRevenueCents > 0
      ? Math.round((totals.netProfitCents * 10_000) / totals.netRevenueCents)
      : 0;
  return totals;
}

export interface ToloTrendPoint {
  date: string;
  netProfitCents: number;
  netRevenueCents: number;
  marginBps: number;
}

/** Daily profit + margin series for the trend chart. */
export async function toloTrend(
  shopId: string,
  range: ToloDateRange,
): Promise<ToloTrendPoint[]> {
  const rows = await prisma.toloDailyProfit.findMany({
    where: { shopId, date: { gte: range.from, lte: range.to } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      netProfitCents: true,
      netRevenueCents: true,
      marginBps: true,
    },
  });
  return rows;
}

export interface ToloProductProfitRow {
  productId: string;
  title: string;
  netProfitCents: number;
  netRevenueCents: number;
  grossCents: number;
  cogsCents: number;
  refundCents: number;
  marginBps: number;
  unitsSold: number;
  refundedUnits: number;
  returnRatePct: number;
  cogsMissing: boolean;
}

/**
 * Per-product profit contribution over a range, joined to product titles.
 * Also flags "popular but unprofitable" (top-quartile revenue, bottom-quartile
 * margin) for the worst-products view.
 */
export async function toloProductProfit(
  shopId: string,
  range: ToloDateRange,
): Promise<{
  rows: ToloProductProfitRow[];
  popularUnprofitable: Set<string>;
}> {
  const grouped = await prisma.toloProductDailyProfit.groupBy({
    by: ["productId"],
    where: { shopId, date: { gte: range.from, lte: range.to } },
    _sum: {
      netProfitCents: true,
      netRevenueCents: true,
      grossCents: true,
      cogsCents: true,
      refundCents: true,
      unitsSold: true,
      refundedUnits: true,
    },
    _max: { cogsMissing: true },
  });

  const titles = await prisma.toloVariant.findMany({
    where: { shopId, productId: { in: grouped.map((g) => g.productId) } },
    select: { productId: true, productTitle: true },
  });
  const titleFor = new Map(titles.map((t) => [t.productId, t.productTitle]));

  const rows: ToloProductProfitRow[] = grouped.map((g) => {
    const netRevenueCents = g._sum.netRevenueCents ?? 0;
    const netProfitCents = g._sum.netProfitCents ?? 0;
    const grossCents = g._sum.grossCents ?? 0;
    const refundCents = g._sum.refundCents ?? 0;
    const unitsSold = g._sum.unitsSold ?? 0;
    const refundedUnits = g._sum.refundedUnits ?? 0;
    return {
      productId: g.productId,
      title: titleFor.get(g.productId) ?? "Unattributed",
      netProfitCents,
      netRevenueCents,
      grossCents,
      cogsCents: g._sum.cogsCents ?? 0,
      refundCents,
      marginBps:
        netRevenueCents > 0
          ? Math.round((netProfitCents * 10_000) / netRevenueCents)
          : 0,
      unitsSold,
      refundedUnits,
      returnRatePct:
        unitsSold + refundedUnits > 0
          ? Math.round((refundedUnits / (unitsSold + refundedUnits)) * 100)
          : 0,
      cogsMissing: g._max.cogsMissing ?? false,
    };
  });

  // Quartile flags: top-quartile revenue AND bottom-quartile margin.
  const popularUnprofitable = new Set<string>();
  if (rows.length >= 4) {
    const byRevenue = [...rows].sort(
      (a, b) => b.netRevenueCents - a.netRevenueCents,
    );
    const byMargin = [...rows].sort((a, b) => a.marginBps - b.marginBps);
    const q = Math.ceil(rows.length / 4);
    const topRevenue = new Set(byRevenue.slice(0, q).map((r) => r.productId));
    const bottomMargin = new Set(byMargin.slice(0, q).map((r) => r.productId));
    for (const id of topRevenue) {
      if (bottomMargin.has(id)) popularUnprofitable.add(id);
    }
  }

  return { rows, popularUnprofitable };
}

/** Single-product cost breakdown + daily trend for the drill-down. */
export async function toloProductDetail(
  shopId: string,
  productId: string,
  range: ToloDateRange,
): Promise<{ totals: ToloProfitTotals; trend: ToloTrendPoint[] }> {
  const rows = await prisma.toloProductDailyProfit.findMany({
    where: { shopId, productId, date: { gte: range.from, lte: range.to } },
    orderBy: { date: "asc" },
  });
  const totals = { ...EMPTY_TOTALS };
  const trend: ToloTrendPoint[] = [];
  for (const row of rows) {
    totals.grossCents += row.grossCents;
    totals.discountCents += row.discountCents;
    totals.refundCents += row.refundCents;
    totals.cogsCents += row.cogsCents;
    totals.shippingCostCents += row.shippingCostCents;
    totals.feeCents += row.feeCents;
    totals.adSpendCents += row.adSpendCents;
    totals.netRevenueCents += row.netRevenueCents;
    totals.netProfitCents += row.netProfitCents;
    totals.unitsSold += row.unitsSold;
    trend.push({
      date: row.date,
      netProfitCents: row.netProfitCents,
      netRevenueCents: row.netRevenueCents,
      marginBps: row.marginBps,
    });
  }
  totals.marginBps =
    totals.netRevenueCents > 0
      ? Math.round((totals.netProfitCents * 10_000) / totals.netRevenueCents)
      : 0;
  return { totals, trend };
}
