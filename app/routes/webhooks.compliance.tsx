import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { toloEnqueue } from "../jobs/tolo-queue.server";
import { toloGdprDataRequest } from "../services/tolo-gdpr.server";

// GDPR mandatory topics. HMAC verification is handled by
// authenticate.webhook — an invalid signature throws a 401 before we run.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // No customer PII stored; single audit write.
      await toloGdprDataRequest(shop, payload);
      break;
    case "CUSTOMERS_REDACT":
      await toloEnqueue("tolo:gdpr-customer-redact", {
        shopDomain: shop,
        payload,
      });
      break;
    case "SHOP_REDACT":
      await toloEnqueue("tolo:shop-purge", { shopDomain: shop });
      break;
    default:
      break;
  }

  return new Response();
};
