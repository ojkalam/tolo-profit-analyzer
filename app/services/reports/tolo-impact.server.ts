import prisma from "../../db.server";
import type { ToloDateRange } from "../profit/tolo-profit-queries.server";

// Order-level contribution profit (excludes daily ad-spend allocation, which
// isn't attributable to a single order): netRevenue − cogs − shipping − fee.
interface ToloOrderContribution {
  discountCodes: string[];
  discountCents: number;
  netRevenueCents: number;
  contributionCents: number;
}

async function toloOrderContributions(
  shopId: string,
  range: ToloDateRange,
): Promise<ToloOrderContribution[]> {
  const orders = await prisma.toloOrderRecord.findMany({
    where: { shopId, day: { gte: range.from, lte: range.to }, test: false },
    include: { lines: { select: { cogsCents: true } } },
  });
  return orders.map((order) => {
    const cogs = order.lines.reduce((sum, l) => sum + (l.cogsCents ?? 0), 0);
    const netRevenueCents =
      order.grossCents - order.discountCents - order.refundCents;
    const contributionCents =
      netRevenueCents - cogs - order.shippingCostCents - order.feeCents;
    return {
      discountCodes: (order.discountCodes as string[] | null) ?? [],
      discountCents: order.discountCents,
      netRevenueCents,
      contributionCents,
    };
  });
}

export interface ToloDiscountImpactRow {
  code: string;
  orders: number;
  discountCents: number;
  profitWithCents: number;
  profitWithoutCents: number;
  netProfitDeltaCents: number;
}

/**
 * Per-discount-code profit: contribution with the code vs. what it would have
 * been without the discount (profitWithout = profitWith + discount given).
 */
export async function toloDiscountImpact(
  shopId: string,
  range: ToloDateRange,
): Promise<ToloDiscountImpactRow[]> {
  const contributions = await toloOrderContributions(shopId, range);
  const byCode = new Map<
    string,
    { orders: number; discount: number; profit: number }
  >();
  for (const order of contributions) {
    if (order.discountCodes.length === 0) continue;
    // Attribute the whole order to each code it carries (codes are usually 1).
    for (const code of order.discountCodes) {
      const entry = byCode.get(code) ?? { orders: 0, discount: 0, profit: 0 };
      entry.orders += 1;
      entry.discount += order.discountCents;
      entry.profit += order.contributionCents;
      byCode.set(code, entry);
    }
  }
  return [...byCode.entries()]
    .map(([code, e]) => ({
      code,
      orders: e.orders,
      discountCents: e.discount,
      profitWithCents: e.profit,
      profitWithoutCents: e.profit + e.discount,
      netProfitDeltaCents: -e.discount,
    }))
    .sort((a, b) => b.discountCents - a.discountCents);
}

export interface ToloReturnsImpactRow {
  productId: string;
  title: string;
  refundCents: number;
  refundedUnits: number;
  unitsSold: number;
  returnRatePct: number;
}

/** Per-product profit lost to returns, with return-rate outliers first. */
export async function toloReturnsImpact(
  shopId: string,
  range: ToloDateRange,
): Promise<ToloReturnsImpactRow[]> {
  const grouped = await prisma.toloProductDailyProfit.groupBy({
    by: ["productId"],
    where: { shopId, date: { gte: range.from, lte: range.to } },
    _sum: { refundCents: true, refundedUnits: true, unitsSold: true },
  });
  const withReturns = grouped.filter((g) => (g._sum.refundCents ?? 0) > 0);
  const titles = await prisma.toloVariant.findMany({
    where: { shopId, productId: { in: withReturns.map((g) => g.productId) } },
    select: { productId: true, productTitle: true },
  });
  const titleFor = new Map(titles.map((t) => [t.productId, t.productTitle]));
  return withReturns
    .map((g) => {
      const refundedUnits = g._sum.refundedUnits ?? 0;
      const unitsSold = g._sum.unitsSold ?? 0;
      const denom = unitsSold + refundedUnits;
      return {
        productId: g.productId,
        title: titleFor.get(g.productId) ?? "Unattributed",
        refundCents: g._sum.refundCents ?? 0,
        refundedUnits,
        unitsSold,
        returnRatePct: denom > 0 ? Math.round((refundedUnits / denom) * 100) : 0,
      };
    })
    .sort((a, b) => b.returnRatePct - a.returnRatePct);
}
