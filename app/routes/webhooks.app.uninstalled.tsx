import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { toloMarkUninstalled } from "../services/tolo-gdpr.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already
  // been uninstalled — toloMarkUninstalled is idempotent and also clears
  // sessions. The hard purge runs on shop/redact (or the 30-day backstop).
  if (session) {
    await toloMarkUninstalled(shop);
  }

  return new Response();
};
