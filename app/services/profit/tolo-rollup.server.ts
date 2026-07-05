import prisma from "../../db.server";
import { toloAddDays, toloDayKey } from "../tolo-dates";
import { toloGetShop } from "../tolo-shops.server";
import { toloLoadCostHistories } from "../sync/tolo-order-sync.server";
import {
  toloResolveLineCogs,
  toloRollupDay,
  type ToloRollupOrder,
} from "./tolo-profit-engine";

/**
 * Recompute ToloDailyProfit + ToloProductDailyProfit for a day range.
 * Idempotent: rollups are caches derived from tolo_order_lines + cost tables.
 * Also refreshes per-line COGS from cost history first, so backdated cost
 * edits propagate (CLAUDE.md §5 rule 2).
 */
export async function toloRollupRange(
  shopDomain: string,
  from?: string,
  to?: string,
): Promise<void> {
  const shop = await toloGetShop(shopDomain);
  const today = toloDayKey(new Date(), shop.ianaTimezone);
  const fromDay = from ?? toloAddDays(today, -2);
  const toDay = to ?? today;

  const orders = await prisma.toloOrderRecord.findMany({
    where: { shopId: shop.id, day: { gte: fromDay, lte: toDay }, test: false },
    include: { lines: true },
  });

  // Refresh line COGS from the history table (source of truth).
  const variantIds = [
    ...new Set(
      orders.flatMap((order) =>
        order.lines
          .map((line) => line.variantId)
          .filter((id): id is string => id != null),
      ),
    ),
  ];
  const histories = await toloLoadCostHistories(shop.id, variantIds);
  for (const order of orders) {
    for (const line of order.lines) {
      if (!line.variantId) continue;
      const resolved = toloResolveLineCogs(
        histories.get(line.variantId) ?? [],
        line.quantity,
        order.processedAt,
      );
      if (
        resolved.cogsCents !== line.cogsCents ||
        resolved.cogsMissing !== line.cogsMissing
      ) {
        await prisma.toloOrderLine.update({
          where: { id: line.id },
          data: {
            cogsCents: resolved.cogsCents,
            cogsMissing: resolved.cogsMissing,
          },
        });
        line.cogsCents = resolved.cogsCents;
        line.cogsMissing = resolved.cogsMissing;
      }
    }
  }

  const adSpendRows = await prisma.toloAdSpendEntry.groupBy({
    by: ["date"],
    where: { shopId: shop.id, date: { gte: fromDay, lte: toDay } },
    _sum: { amountCents: true },
  });
  const adSpendByDay = new Map(
    adSpendRows.map((row) => [row.date, row._sum.amountCents ?? 0]),
  );

  // Every day that has orders or ad spend in range gets a fresh rollup row.
  const days = new Set<string>([
    ...orders.map((order) => order.day),
    ...adSpendByDay.keys(),
  ]);

  for (const day of days) {
    const dayOrders: ToloRollupOrder[] = orders
      .filter((order) => order.day === day)
      .map((order) => ({
        grossCents: order.grossCents,
        discountCents: order.discountCents,
        refundCents: order.refundCents,
        feeCents: order.feeCents,
        shippingCostCents: order.shippingCostCents,
        lines: order.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          revenueCents: line.revenueCents,
          discountCents: line.discountCents,
          refundedQuantity: line.refundedQuantity,
          refundedCents: line.refundedCents,
          cogsCents: line.cogsCents,
          cogsMissing: line.cogsMissing,
        })),
      }));

    const { daily, products } = toloRollupDay(
      dayOrders,
      adSpendByDay.get(day) ?? 0,
    );

    await prisma.toloDailyProfit.upsert({
      where: { shopId_date: { shopId: shop.id, date: day } },
      create: { shopId: shop.id, date: day, ...daily },
      update: daily,
    });

    await prisma.toloProductDailyProfit.deleteMany({
      where: { shopId: shop.id, date: day },
    });
    if (products.length > 0) {
      await prisma.toloProductDailyProfit.createMany({
        data: products.map(({ productId, ...totals }) => ({
          shopId: shop.id,
          productId,
          date: day,
          ...totals,
        })),
      });
    }
  }
}
