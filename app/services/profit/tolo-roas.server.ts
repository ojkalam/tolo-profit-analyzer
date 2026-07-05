import prisma from "../../db.server";
import type { ToloDateRange } from "./tolo-profit-queries.server";

export interface ToloRoasSummary {
  adSpendCents: number;
  netRevenueCents: number;
  // Profit before ad spend — the numerator for a profit-based (true) ROAS.
  profitBeforeAdsCents: number;
  netProfitCents: number;
  /** Revenue ROAS: net revenue / ad spend. */
  revenueRoas: number;
  /** True ROAS: profit before ads / ad spend. */
  profitRoas: number;
  /** Contribution margin ratio: profit-before-ads / net revenue. */
  contributionMarginRatio: number;
  /** Break-even revenue ROAS: 1 / contribution margin ratio. */
  breakEvenRoas: number;
}

/**
 * True ROAS (CLAUDE.md 6.2): ad spend measured against *profit*, not revenue.
 * Break-even ROAS is the revenue-ROAS at which ads exactly pay for themselves
 * given the contribution margin.
 */
export async function toloRoasSummary(
  shopId: string,
  range: ToloDateRange,
): Promise<ToloRoasSummary> {
  const rows = await prisma.toloDailyProfit.findMany({
    where: { shopId, date: { gte: range.from, lte: range.to } },
    select: {
      adSpendCents: true,
      netRevenueCents: true,
      netProfitCents: true,
    },
  });
  const adSpendCents = rows.reduce((s, r) => s + r.adSpendCents, 0);
  const netRevenueCents = rows.reduce((s, r) => s + r.netRevenueCents, 0);
  const netProfitCents = rows.reduce((s, r) => s + r.netProfitCents, 0);
  const profitBeforeAdsCents = netProfitCents + adSpendCents;

  const revenueRoas = adSpendCents > 0 ? netRevenueCents / adSpendCents : 0;
  const profitRoas =
    adSpendCents > 0 ? profitBeforeAdsCents / adSpendCents : 0;
  const contributionMarginRatio =
    netRevenueCents > 0 ? profitBeforeAdsCents / netRevenueCents : 0;
  const breakEvenRoas =
    contributionMarginRatio > 0 ? 1 / contributionMarginRatio : 0;

  return {
    adSpendCents,
    netRevenueCents,
    profitBeforeAdsCents,
    netProfitCents,
    revenueRoas,
    profitRoas,
    contributionMarginRatio,
    breakEvenRoas,
  };
}

export interface ToloRoasChannelRow {
  channel: string;
  adSpendCents: number;
}

/** Ad spend by channel over the range — the denominator breakdown. */
export async function toloRoasByChannel(
  shopId: string,
  range: ToloDateRange,
): Promise<ToloRoasChannelRow[]> {
  const grouped = await prisma.toloAdSpendEntry.groupBy({
    by: ["channel"],
    where: { shopId, date: { gte: range.from, lte: range.to } },
    _sum: { amountCents: true },
  });
  return grouped
    .map((g) => ({ channel: g.channel, adSpendCents: g._sum.amountCents ?? 0 }))
    .sort((a, b) => b.adSpendCents - a.adSpendCents);
}
