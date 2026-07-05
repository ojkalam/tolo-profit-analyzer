import prisma from "../../db.server";
import { toloEnqueue } from "../../jobs/tolo-queue.server";
import { toloCaptureException } from "../tolo-sentry.server";
import { toloGraphql } from "../tolo-graphql.server";
import { toloAdminForShop, toloEnsureShop, toloGetShop } from "../tolo-shops.server";
import { toloDayKey } from "../tolo-dates";
import {
  toloTransformOrder,
  type ToloRawLineItem,
  type ToloRawOrder,
} from "./tolo-order-transform";
import { toloUpsertNormalizedOrder } from "./tolo-order-sync.server";

const TOLO_BULK_START_MUTATION = `#graphql
  mutation ToloBulkImportStart($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const TOLO_BULK_POLL_QUERY = `#graphql
  query ToloBulkImportPoll($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        objectCount
        url
      }
    }
  }
`;

// The bulk query mirrors ToloOrderSync minus per-line refund detail —
// refund line items nest a connection inside a list, which Bulk Operations
// reject. Historical orders therefore carry order-level refund totals only;
// webhook-synced orders get full per-line refunds.
function toloBulkOrdersQuery(sinceIso: string): string {
  return `
  {
    orders(query: "processed_at:>='${sinceIso}'") {
      edges {
        node {
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
          lineItems {
            edges {
              node {
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
          }
        }
      }
    }
  }`;
}

/** History window by plan: Pro gets 24 months, everyone else 90 days. */
export function toloImportMonthsForPlan(plan: string): number {
  return plan === "pro" ? 24 : 3;
}

/** Job handler: kick off the historical order import. */
export async function toloStartBulkImport(
  shopDomain: string,
  months?: number,
): Promise<void> {
  const graphql = await toloAdminForShop(shopDomain);
  const shop = await toloEnsureShop(shopDomain, graphql);
  const windowMonths = months ?? toloImportMonthsForPlan(shop.plan);
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - windowMonths);

  const data = await toloGraphql<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(graphql, TOLO_BULK_START_MUTATION, {
    query: toloBulkOrdersQuery(since.toISOString()),
  });

  const { bulkOperation, userErrors } = data.bulkOperationRunQuery;
  if (!bulkOperation || userErrors.length > 0) {
    await prisma.toloShop.update({
      where: { id: shop.id },
      data: { importStatus: "failed" },
    });
    toloCaptureException(
      new Error(
        `Bulk import start failed: ${userErrors.map((e) => e.message).join("; ")}`,
      ),
      { shopDomain },
    );
    return;
  }

  await prisma.toloShop.update({
    where: { id: shop.id },
    data: {
      importStatus: "running",
      importProgress: 5,
      bulkOperationId: bulkOperation.id,
    },
  });

  await toloEnqueue("tolo:bulk-import-poll", { shopDomain }, { delayMs: 8_000 });
}

interface ToloBulkJsonlRow {
  id?: string;
  __parentId?: string;
  [key: string]: unknown;
}

/** Reassemble bulk JSONL rows into full order objects with nested lines. */
export function toloAssembleBulkOrders(jsonl: string): ToloRawOrder[] {
  const orders = new Map<string, ToloRawOrder>();
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed) as ToloBulkJsonlRow;
    if (!row.__parentId && typeof row.id === "string") {
      const order = row as unknown as ToloRawOrder;
      order.lineItems = { nodes: [] };
      orders.set(row.id, order);
    } else if (row.__parentId) {
      const parent = orders.get(row.__parentId);
      if (parent?.lineItems?.nodes) {
        parent.lineItems.nodes.push(row as unknown as ToloRawLineItem);
      }
    }
  }
  return [...orders.values()];
}

/** Job handler: poll the running bulk operation; process when complete. */
export async function toloPollBulkImport(shopDomain: string): Promise<void> {
  const shop = await toloGetShop(shopDomain);
  if (!shop.bulkOperationId || shop.importStatus !== "running") return;

  const graphql = await toloAdminForShop(shopDomain);
  const data = await toloGraphql<{
    node: {
      id: string;
      status: string;
      errorCode: string | null;
      objectCount: string;
      url: string | null;
    } | null;
  }>(graphql, TOLO_BULK_POLL_QUERY, { id: shop.bulkOperationId });

  const op = data.node;
  if (!op) return;

  if (op.status === "CREATED" || op.status === "RUNNING") {
    const seen = Number(op.objectCount) || 0;
    await prisma.toloShop.update({
      where: { id: shop.id },
      data: { importProgress: Math.min(90, 10 + Math.floor(seen / 20)) },
    });
    await toloEnqueue("tolo:bulk-import-poll", { shopDomain }, { delayMs: 10_000 });
    return;
  }

  if (op.status !== "COMPLETED") {
    await prisma.toloShop.update({
      where: { id: shop.id },
      data: { importStatus: "failed" },
    });
    toloCaptureException(
      new Error(`Bulk import ${op.status}: ${op.errorCode ?? "unknown"}`),
      { shopDomain },
    );
    return;
  }

  let earliestDay: string | null = null;
  if (op.url) {
    const response = await fetch(op.url);
    const jsonl = await response.text();
    const rawOrders = toloAssembleBulkOrders(jsonl);
    for (const raw of rawOrders) {
      const normalized = toloTransformOrder(raw);
      // Skip per-order rollup enqueues; one range rollup runs at the end.
      await toloUpsertNormalizedOrder(shop, normalized, {
        enqueueRollup: false,
      });
      if (!normalized.cancelled) {
        const day = toloDayKey(normalized.processedAt, shop.ianaTimezone);
        if (!earliestDay || day < earliestDay) earliestDay = day;
      }
    }
  }

  await prisma.toloShop.update({
    where: { id: shop.id },
    data: { importStatus: "complete", importProgress: 100, bulkOperationId: null },
  });

  const today = toloDayKey(new Date(), shop.ianaTimezone);
  await toloEnqueue("tolo:rollup", {
    shopDomain,
    from: earliestDay ?? today,
    to: today,
  });
  await toloEnqueue("tolo:alert-scan", { shopDomain }, { delayMs: 15_000 });
}
