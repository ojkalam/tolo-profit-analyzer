import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { toloSyncPlanFromSubscription } from "../services/billing/tolo-billing.server";

// app_subscriptions/update — keeps ToloShop.plan in lockstep with Shopify
// Billing. A single DB write, so no job needed.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const subscription = (
    payload as {
      app_subscription?: { name?: string; status?: string };
    }
  ).app_subscription;
  await toloSyncPlanFromSubscription(shop, subscription);

  return new Response();
};
