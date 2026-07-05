import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { toloEnqueue } from "../jobs/tolo-queue.server";

// products/update — keeps the catalog cache and imported costs fresh.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const productId = (payload as { admin_graphql_api_id?: string })
    .admin_graphql_api_id;
  if (productId) {
    await toloEnqueue(
      "tolo:catalog-sync",
      { shopDomain: shop, productId },
      { dedupeId: `tolo:catalog-sync:${shop}:${productId}`, delayMs: 5_000 },
    );
  }

  return new Response();
};
