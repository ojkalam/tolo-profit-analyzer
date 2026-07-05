import { toloEnqueue } from "../../jobs/tolo-queue.server";
import { toloGraphql } from "../tolo-graphql.server";
import { toloAdminForShop } from "../tolo-shops.server";

const TOLO_RECONCILE_QUERY = `#graphql
  query ToloReconcileOrders($query: String!, $cursor: String) {
    orders(first: 100, after: $cursor, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
      }
    }
  }
`;

/**
 * Webhooks aren't guaranteed delivery — nightly, re-sync every order updated
 * in the last 3 days. Upserts are idempotent, so over-syncing is harmless.
 */
export async function toloReconcileShop(shopDomain: string): Promise<void> {
  const graphql = await toloAdminForShop(shopDomain);
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  let cursor: string | null = null;
  for (;;) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string }>;
      };
    } = await toloGraphql(graphql, TOLO_RECONCILE_QUERY, {
      query: `updated_at:>='${since}'`,
      cursor,
    });
    for (const order of data.orders.nodes) {
      await toloEnqueue("tolo:order-sync", { shopDomain, orderId: order.id });
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
}
