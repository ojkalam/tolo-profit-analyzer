import prisma from "../../db.server";
import type { ToloDateRange } from "../profit/tolo-profit-queries.server";

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  return [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

const centsToStr = (cents: number) => (cents / 100).toFixed(2);

/** Order-level profit export (contribution profit; excludes daily ad spend). */
export async function toloOrderCsv(
  shopId: string,
  range: ToloDateRange,
  currency: string,
): Promise<string> {
  const orders = await prisma.toloOrderRecord.findMany({
    where: { shopId, day: { gte: range.from, lte: range.to }, test: false },
    include: { lines: { select: { cogsCents: true, cogsMissing: true } } },
    orderBy: { processedAt: "asc" },
  });
  const rows = orders.map((order) => {
    const cogs = order.lines.reduce((s, l) => s + (l.cogsCents ?? 0), 0);
    const anyMissing = order.lines.some((l) => l.cogsMissing);
    const netRevenue =
      order.grossCents - order.discountCents - order.refundCents;
    const contribution =
      netRevenue - cogs - order.shippingCostCents - order.feeCents;
    return [
      order.orderNumber ?? order.shopifyOrderId,
      order.day,
      currency,
      centsToStr(order.grossCents),
      centsToStr(order.discountCents),
      centsToStr(order.refundCents),
      centsToStr(cogs),
      centsToStr(order.shippingCostCents),
      centsToStr(order.feeCents),
      centsToStr(netRevenue),
      centsToStr(contribution),
      anyMissing ? "yes" : "no",
    ];
  });
  return toCsv(
    [
      "order",
      "day",
      "currency",
      "gross",
      "discounts",
      "refunds",
      "cogs",
      "shipping_cost",
      "fees",
      "net_revenue",
      "contribution_profit",
      "cost_missing",
    ],
    rows,
  );
}

/** Product-level daily profit export (includes allocated ad spend). */
export async function toloProductCsv(
  shopId: string,
  range: ToloDateRange,
  currency: string,
): Promise<string> {
  const grouped = await prisma.toloProductDailyProfit.groupBy({
    by: ["productId"],
    where: { shopId, date: { gte: range.from, lte: range.to } },
    _sum: {
      grossCents: true,
      discountCents: true,
      refundCents: true,
      cogsCents: true,
      shippingCostCents: true,
      feeCents: true,
      adSpendCents: true,
      netRevenueCents: true,
      netProfitCents: true,
      unitsSold: true,
    },
  });
  const titles = await prisma.toloVariant.findMany({
    where: { shopId, productId: { in: grouped.map((g) => g.productId) } },
    select: { productId: true, productTitle: true },
  });
  const titleFor = new Map(titles.map((t) => [t.productId, t.productTitle]));
  const rows = grouped.map((g) => {
    const netRev = g._sum.netRevenueCents ?? 0;
    const netProfit = g._sum.netProfitCents ?? 0;
    const marginPct = netRev > 0 ? ((netProfit / netRev) * 100).toFixed(1) : "0";
    return [
      titleFor.get(g.productId) ?? "Unattributed",
      currency,
      centsToStr(g._sum.grossCents ?? 0),
      centsToStr(g._sum.discountCents ?? 0),
      centsToStr(g._sum.refundCents ?? 0),
      centsToStr(g._sum.cogsCents ?? 0),
      centsToStr(g._sum.shippingCostCents ?? 0),
      centsToStr(g._sum.feeCents ?? 0),
      centsToStr(g._sum.adSpendCents ?? 0),
      centsToStr(netRev),
      centsToStr(netProfit),
      marginPct,
      g._sum.unitsSold ?? 0,
    ];
  });
  return toCsv(
    [
      "product",
      "currency",
      "gross",
      "discounts",
      "refunds",
      "cogs",
      "shipping_cost",
      "fees",
      "ad_spend",
      "net_revenue",
      "net_profit",
      "margin_pct",
      "units_sold",
    ],
    rows,
  );
}
