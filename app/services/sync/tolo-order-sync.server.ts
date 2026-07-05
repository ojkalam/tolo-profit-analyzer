import type { ToloShop } from "@prisma/client";
import prisma from "../../db.server";
import { toloEnqueue } from "../../jobs/tolo-queue.server";
import { toloDayKey } from "../tolo-dates";
import { toloGraphql } from "../tolo-graphql.server";
import { toloAdminForShop, toloEnsureShop } from "../tolo-shops.server";
import {
  toloComputeFeeCents,
  toloResolveLineCogs,
  toloResolveShippingCost,
  type ToloCostHistoryEntry,
  type ToloShippingRuleInput,
} from "../profit/tolo-profit-engine";
import {
  toloTransformOrder,
  type ToloNormalizedOrder,
  type ToloRawOrder,
} from "./tolo-order-transform";

const TOLO_ORDER_SYNC_QUERY = `#graphql
  query ToloOrderSync($id: ID!) {
    order: node(id: $id) {
      ... on Order {
        id
        name
        processedAt
        cancelledAt
        test
        currencyCode
        totalWeight
        shippingAddress {
          countryCodeV2
        }
        discountCodes
        totalDiscountsSet {
          shopMoney {
            amount
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
          }
        }
        lineItems(first: 100) {
          nodes {
            id
            title
            quantity
            product {
              id
            }
            variant {
              id
            }
            originalTotalSet {
              shopMoney {
                amount
              }
            }
            discountAllocations {
              allocatedAmountSet {
                shopMoney {
                  amount
                }
              }
            }
          }
        }
        refunds(first: 60) {
          id
          totalRefundedSet {
            shopMoney {
              amount
            }
          }
          refundLineItems(first: 100) {
            nodes {
              quantity
              subtotalSet {
                shopMoney {
                  amount
                }
              }
              lineItem {
                id
              }
            }
          }
        }
      }
    }
  }
`;

/** Load COGS history for a set of variants, keyed by variantId. */
export async function toloLoadCostHistories(
  shopId: string,
  variantIds: string[],
): Promise<Map<string, ToloCostHistoryEntry[]>> {
  if (variantIds.length === 0) return new Map();
  const rows = await prisma.toloProductCost.findMany({
    where: { shopId, variantId: { in: variantIds } },
    select: { variantId: true, costCents: true, effectiveFrom: true },
  });
  const histories = new Map<string, ToloCostHistoryEntry[]>();
  for (const row of rows) {
    const list = histories.get(row.variantId) ?? [];
    list.push({ costCents: row.costCents, effectiveFrom: row.effectiveFrom });
    histories.set(row.variantId, list);
  }
  return histories;
}

export async function toloLoadShippingRules(
  shopId: string,
): Promise<ToloShippingRuleInput[]> {
  const rules = await prisma.toloShippingRule.findMany({
    where: { shopId, active: true },
    orderBy: { priority: "asc" },
  });
  return rules.map((rule) => ({
    id: rule.id,
    kind: rule.kind as ToloShippingRuleInput["kind"],
    config: rule.config,
    priority: rule.priority,
    active: rule.active,
  }));
}

/**
 * Upsert a normalized order with full cost enrichment. Shared by the webhook
 * sync path and the bulk importer. Idempotent: lines are replaced wholesale.
 */
export async function toloUpsertNormalizedOrder(
  shop: ToloShop,
  normalized: ToloNormalizedOrder,
  options: { enqueueRollup?: boolean } = {},
): Promise<void> {
  if (normalized.cancelled) {
    // Cancelled orders contribute nothing; drop any earlier record.
    await prisma.toloOrderRecord.deleteMany({
      where: { shopId: shop.id, shopifyOrderId: normalized.shopifyOrderId },
    });
    return;
  }

  const day = toloDayKey(normalized.processedAt, shop.ianaTimezone);

  const variantIds = normalized.lines
    .map((line) => line.variantId)
    .filter((id): id is string => id != null);
  const [histories, rules] = await Promise.all([
    toloLoadCostHistories(shop.id, variantIds),
    toloLoadShippingRules(shop.id),
  ]);

  const shipping = toloResolveShippingCost(rules, {
    itemCount: normalized.lines.reduce((sum, line) => sum + line.quantity, 0),
    totalWeightGrams: normalized.totalWeightGrams,
    countryCode: normalized.countryCode,
  });

  const chargedCents =
    normalized.grossCents -
    normalized.discountCents +
    normalized.shippingChargedCents;
  const feeCents = toloComputeFeeCents(chargedCents, {
    feeRateBps: shop.feeRateBps,
    feeFixedCents: shop.feeFixedCents,
  });

  const recordData = {
    shopId: shop.id,
    shopifyOrderId: normalized.shopifyOrderId,
    orderNumber: normalized.orderNumber,
    processedAt: normalized.processedAt,
    day,
    grossCents: normalized.grossCents,
    discountCents: normalized.discountCents,
    refundCents: normalized.refundCents,
    shippingChargedCents: normalized.shippingChargedCents,
    feeCents,
    shippingCostCents: shipping.costCents,
    currency: normalized.currency,
    countryCode: normalized.countryCode,
    totalWeightGrams: normalized.totalWeightGrams,
    discountCodes: normalized.discountCodes,
    test: normalized.test,
  };

  const record = await prisma.toloOrderRecord.upsert({
    where: {
      shopId_shopifyOrderId: {
        shopId: shop.id,
        shopifyOrderId: normalized.shopifyOrderId,
      },
    },
    create: recordData,
    update: recordData,
  });

  await prisma.toloOrderLine.deleteMany({
    where: { shopId: shop.id, orderRecordId: record.id },
  });
  if (normalized.lines.length > 0) {
    await prisma.toloOrderLine.createMany({
      data: normalized.lines.map((line) => {
        const cogs = line.variantId
          ? toloResolveLineCogs(
              histories.get(line.variantId) ?? [],
              line.quantity,
              normalized.processedAt,
            )
          : { cogsCents: null, cogsMissing: true };
        return {
          orderRecordId: record.id,
          shopId: shop.id,
          variantId: line.variantId,
          productId: line.productId,
          title: line.title,
          quantity: line.quantity,
          revenueCents: line.revenueCents,
          discountCents: line.discountCents,
          cogsCents: cogs.cogsCents,
          cogsMissing: cogs.cogsMissing,
          refundedQuantity: line.refundedQuantity,
          refundedCents: line.refundedCents,
        };
      }),
    });
  }

  if (options.enqueueRollup !== false) {
    // Debounced per shop+day so webhook bursts collapse into one recompute.
    await toloEnqueue(
      "tolo:rollup",
      { shopDomain: shop.shopDomain, from: day, to: day },
      { dedupeId: `tolo:rollup:${shop.shopDomain}:${day}`, delayMs: 3_000 },
    );
  }
}

/** Job handler: fetch one order from the Admin API and upsert it. */
export async function toloSyncOrder(
  shopDomain: string,
  orderId: string,
): Promise<void> {
  const graphql = await toloAdminForShop(shopDomain);
  const shop = await toloEnsureShop(shopDomain);
  const data = await toloGraphql<{ order: ToloRawOrder | null }>(
    graphql,
    TOLO_ORDER_SYNC_QUERY,
    { id: orderId },
  );
  if (!data.order || !data.order.id) {
    // Deleted or inaccessible order — nothing to sync.
    return;
  }
  const normalized = toloTransformOrder(data.order);
  await toloUpsertNormalizedOrder(shop, normalized);
}
