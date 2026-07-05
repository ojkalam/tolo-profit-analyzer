import type { ToloShop } from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { toloCaptureException } from "./tolo-sentry.server";

export type ToloAdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

/** Offline Admin API client for background jobs. */
export async function toloAdminForShop(
  shopDomain: string,
): Promise<ToloAdminGraphql> {
  const { admin } = await unauthenticated.admin(shopDomain);
  return admin.graphql.bind(admin) as ToloAdminGraphql;
}

const TOLO_SHOP_INFO_QUERY = `#graphql
  query ToloShopInfo {
    shop {
      name
      currencyCode
      ianaTimezone
    }
  }
`;

/**
 * Get-or-create the ToloShop row. When an admin client is supplied, refresh
 * currency/timezone from the API (cheap, and settings drift otherwise).
 */
export async function toloEnsureShop(
  shopDomain: string,
  graphql?: ToloAdminGraphql,
): Promise<ToloShop> {
  let shop = await prisma.toloShop.findUnique({ where: { shopDomain } });
  if (!shop) {
    shop = await prisma.toloShop.create({
      data: {
        shopDomain,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
  } else if (shop.uninstalledAt) {
    // Re-install: clear the uninstall/purge markers.
    shop = await prisma.toloShop.update({
      where: { shopDomain },
      data: { uninstalledAt: null, purgeAfter: null },
    });
  }

  if (graphql) {
    try {
      const response = await graphql(TOLO_SHOP_INFO_QUERY);
      const body = (await response.json()) as {
        data?: {
          shop?: { currencyCode?: string; ianaTimezone?: string };
        };
      };
      const info = body.data?.shop;
      if (info?.currencyCode && info?.ianaTimezone) {
        shop = await prisma.toloShop.update({
          where: { shopDomain },
          data: {
            currency: info.currencyCode,
            ianaTimezone: info.ianaTimezone,
          },
        });
      }
    } catch (error) {
      // Non-fatal: defaults stand until the next successful refresh.
      toloCaptureException(error, { shopDomain, during: "toloEnsureShop" });
    }
  }

  return shop;
}

export async function toloGetShop(shopDomain: string): Promise<ToloShop> {
  const shop = await prisma.toloShop.findUnique({ where: { shopDomain } });
  if (!shop) {
    throw new Error(`ToloShop not provisioned for ${shopDomain}`);
  }
  return shop;
}
