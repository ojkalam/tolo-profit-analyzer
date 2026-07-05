import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import type { BillingConfigSubscriptionLineItemPlan } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { toloEnsureShop } from "./services/tolo-shops.server";
import { toloEnqueue } from "./jobs/tolo-queue.server";
import { toloCaptureException } from "./services/tolo-sentry.server";

// Billing plan names must match TOLO_PLANS billingName values.
export const TOLO_BILLING_PLANS: Record<
  string,
  BillingConfigSubscriptionLineItemPlan
> = {
  "Tolo Basic": {
    trialDays: 14,
    lineItems: [
      {
        amount: 9,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
  },
  "Tolo Growth": {
    trialDays: 14,
    lineItems: [
      {
        amount: 29,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
  },
  "Tolo Pro": {
    trialDays: 14,
    lineItems: [
      {
        amount: 79,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
  },
};

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: TOLO_BILLING_PLANS,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    // Provision the shop and kick off first sync. Webhooks are NOT
    // registered here — they're declared in shopify.app.toml (CLAUDE.md §7.3).
    afterAuth: async ({ session, admin }) => {
      try {
        const shop = await toloEnsureShop(
          session.shop,
          admin.graphql.bind(admin),
        );
        if (shop.importStatus === "pending") {
          await toloEnqueue("tolo:catalog-sync", { shopDomain: session.shop });
          await toloEnqueue(
            "tolo:bulk-import",
            { shopDomain: session.shop },
            // Catalog first so imported COGS applies to historical orders.
            { delayMs: 10_000 },
          );
        }
      } catch (error) {
        toloCaptureException(error, {
          shopDomain: session.shop,
          during: "afterAuth",
        });
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
