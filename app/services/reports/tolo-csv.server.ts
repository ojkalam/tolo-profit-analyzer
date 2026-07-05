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

/**
 * Accountant pack (CLAUDE.md 6.5): one summarized row per calendar month over
 * the range — the P&L-style bundle to hand an accountant.
 */
export async function toloMonthlyCsv(
  shopId: string,
  range: ToloDateRange,
  currency: string,
): Promise<string> {
  const days = await prisma.toloDailyProfit.findMany({
    where: { shopId, date: { gte: range.from, lte: range.to } },
    orderBy: { date: "asc" },
  });
  const byMonth = new Map<
    string,
    {
      gross: number;
      discount: number;
      refund: number;
      cogs: number;
      shipping: number;
      fee: number;
      ad: number;
      netRevenue: number;
      netProfit: number;
      orders: number;
    }
  >();
  for (const d of days) {
    const month = d.date.slice(0, 7);
    const m = byMonth.get(month) ?? {
      gross: 0,
      discount: 0,
      refund: 0,
      cogs: 0,
      shipping: 0,
      fee: 0,
      ad: 0,
      netRevenue: 0,
      netProfit: 0,
      orders: 0,
    };
    m.gross += d.grossCents;
    m.discount += d.discountCents;
    m.refund += d.refundCents;
    m.cogs += d.cogsCents;
    m.shipping += d.shippingCostCents;
    m.fee += d.feeCents;
    m.ad += d.adSpendCents;
    m.netRevenue += d.netRevenueCents;
    m.netProfit += d.netProfitCents;
    m.orders += d.ordersCount;
    byMonth.set(month, m);
  }
  const rows = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, m]) => {
      const marginPct =
        m.netRevenue > 0 ? ((m.netProfit / m.netRevenue) * 100).toFixed(1) : "0";
      return [
        month,
        currency,
        m.orders,
        centsToStr(m.gross),
        centsToStr(m.discount),
        centsToStr(m.refund),
        centsToStr(m.cogs),
        centsToStr(m.shipping),
        centsToStr(m.fee),
        centsToStr(m.ad),
        centsToStr(m.netRevenue),
        centsToStr(m.netProfit),
        marginPct,
      ];
    });
  return toCsv(
    [
      "month",
      "currency",
      "orders",
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
