import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { toloEnqueue } from "../jobs/tolo-queue.server";

// refunds/create — the refund payload carries order_id; re-syncing the whole
// order pulls refund totals and per-line refund detail in one path.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const orderId = (payload as { order_id?: number | string }).order_id;
  if (orderId != null) {
    const orderGid = `gid://shopify/Order/${orderId}`;
    await toloEnqueue(
      "tolo:order-sync",
      { shopDomain: shop, orderId: orderGid },
      { dedupeId: `tolo:order-sync:${shop}:${orderGid}`, delayMs: 2_000 },
    );
  }

  return new Response();
};
