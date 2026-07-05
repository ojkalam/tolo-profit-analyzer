import type { ToloShop } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { toloEnsureShop } from "./tolo-shops.server";

export interface ToloAppContext {
  shop: ToloShop;
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"];
  session: Awaited<ReturnType<typeof authenticate.admin>>["session"];
}

/**
 * Standard admin-route entry: authenticate the embedded session and load the
 * provisioned ToloShop row. Use in every loader/action under app/routes/app.*.
 */
export async function toloAppContext(request: Request): Promise<ToloAppContext> {
  const { admin, session } = await authenticate.admin(request);
  const shop = await toloEnsureShop(session.shop);
  return { shop, admin, session };
}
