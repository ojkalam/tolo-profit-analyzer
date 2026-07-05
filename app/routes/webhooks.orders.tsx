import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { toloEnqueue } from "../jobs/tolo-queue.server";

// orders/create + orders/updated. Enqueue and return — no computation here
// (Shopify retires slow webhook endpoints).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const orderId = (payload as { admin_graphql_api_id?: string })
    .admin_graphql_api_id;
  if (orderId) {
    await toloEnqueue(
      "tolo:order-sync",
      { shopDomain: shop, orderId },
      // Create + rapid updates for the same order collapse into one sync.
      { dedupeId: `tolo:order-sync:${shop}:${orderId}`, delayMs: 2_000 },
    );
  }

  console.log(`[tolo] ${topic} webhook enqueued for ${shop}`);
  return new Response();
};
