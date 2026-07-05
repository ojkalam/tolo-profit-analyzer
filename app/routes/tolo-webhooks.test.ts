import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shopify.server", () => ({
  authenticate: { webhook: vi.fn() },
}));
vi.mock("../jobs/tolo-queue.server", () => ({
  toloEnqueue: vi.fn(),
}));
vi.mock("../services/tolo-gdpr.server", () => ({
  toloGdprDataRequest: vi.fn(),
  toloMarkUninstalled: vi.fn(),
}));
vi.mock("../services/billing/tolo-billing.server", () => ({
  toloSyncPlanFromSubscription: vi.fn(),
}));

import { authenticate } from "../shopify.server";
import { toloEnqueue } from "../jobs/tolo-queue.server";
import {
  toloGdprDataRequest,
  toloMarkUninstalled,
} from "../services/tolo-gdpr.server";
import { toloSyncPlanFromSubscription } from "../services/billing/tolo-billing.server";
import { action as ordersAction } from "./webhooks.orders";
import { action as refundsAction } from "./webhooks.refunds";
import { action as productsAction } from "./webhooks.products";
import { action as complianceAction } from "./webhooks.compliance";
import { action as uninstalledAction } from "./webhooks.app.uninstalled";
import { action as subscriptionAction } from "./webhooks.app_subscriptions.update";

const mockWebhook = vi.mocked(authenticate.webhook);
const request = () => new Request("https://tolo.test/webhooks");
const args = () => ({ request: request(), params: {}, context: {} }) as never;

beforeEach(() => {
  vi.clearAllMocks();
});

function stubWebhook(topic: string, payload: unknown, session: unknown = {}) {
  mockWebhook.mockResolvedValue({
    shop: "meatworld-yhz25ler.myshopify.com",
    topic,
    payload,
    session,
  } as never);
}

describe("webhook handlers enqueue and return 200", () => {
  it("orders/create enqueues an order sync", async () => {
    stubWebhook("ORDERS_CREATE", {
      admin_graphql_api_id: "gid://shopify/Order/1",
    });
    const response = await ordersAction(args());
    expect(response.status).toBe(200);
    expect(toloEnqueue).toHaveBeenCalledWith(
      "tolo:order-sync",
      {
        shopDomain: "meatworld-yhz25ler.myshopify.com",
        orderId: "gid://shopify/Order/1",
      },
      expect.objectContaining({ dedupeId: expect.stringContaining("Order/1") }),
    );
  });

  it("orders webhook without an id still returns 200", async () => {
    stubWebhook("ORDERS_UPDATED", {});
    const response = await ordersAction(args());
    expect(response.status).toBe(200);
    expect(toloEnqueue).not.toHaveBeenCalled();
  });

  it("refunds/create re-syncs the parent order by numeric id", async () => {
    stubWebhook("REFUNDS_CREATE", { order_id: 42 });
    const response = await refundsAction(args());
    expect(response.status).toBe(200);
    expect(toloEnqueue).toHaveBeenCalledWith(
      "tolo:order-sync",
      expect.objectContaining({ orderId: "gid://shopify/Order/42" }),
      expect.anything(),
    );
  });

  it("products/update enqueues a single-product catalog sync", async () => {
    stubWebhook("PRODUCTS_UPDATE", {
      admin_graphql_api_id: "gid://shopify/Product/7",
    });
    const response = await productsAction(args());
    expect(response.status).toBe(200);
    expect(toloEnqueue).toHaveBeenCalledWith(
      "tolo:catalog-sync",
      expect.objectContaining({ productId: "gid://shopify/Product/7" }),
      expect.anything(),
    );
  });

  it("shop/redact enqueues the purge job", async () => {
    stubWebhook("SHOP_REDACT", {});
    const response = await complianceAction(args());
    expect(response.status).toBe(200);
    expect(toloEnqueue).toHaveBeenCalledWith("tolo:shop-purge", {
      shopDomain: "meatworld-yhz25ler.myshopify.com",
    });
  });

  it("customers/data_request audits inline (no PII stored)", async () => {
    stubWebhook("CUSTOMERS_DATA_REQUEST", { orders_requested: [] });
    const response = await complianceAction(args());
    expect(response.status).toBe(200);
    expect(toloGdprDataRequest).toHaveBeenCalled();
    expect(toloEnqueue).not.toHaveBeenCalled();
  });

  it("customers/redact enqueues the redact job", async () => {
    stubWebhook("CUSTOMERS_REDACT", { customer: { id: 1 } });
    const response = await complianceAction(args());
    expect(response.status).toBe(200);
    expect(toloEnqueue).toHaveBeenCalledWith(
      "tolo:gdpr-customer-redact",
      expect.objectContaining({ shopDomain: expect.any(String) }),
    );
  });

  it("app/uninstalled marks the shop when a session exists", async () => {
    stubWebhook("APP_UNINSTALLED", {}, { id: "session-1" });
    const response = await uninstalledAction(args());
    expect(response.status).toBe(200);
    expect(toloMarkUninstalled).toHaveBeenCalledWith(
      "meatworld-yhz25ler.myshopify.com",
    );
  });

  it("app/uninstalled is a no-op when the session is already gone", async () => {
    stubWebhook("APP_UNINSTALLED", {}, null);
    const response = await uninstalledAction(args());
    expect(response.status).toBe(200);
    expect(toloMarkUninstalled).not.toHaveBeenCalled();
  });

  it("app_subscriptions/update syncs the plan", async () => {
    stubWebhook("APP_SUBSCRIPTIONS_UPDATE", {
      app_subscription: { name: "Tolo Growth", status: "ACTIVE" },
    });
    const response = await subscriptionAction(args());
    expect(response.status).toBe(200);
    expect(toloSyncPlanFromSubscription).toHaveBeenCalledWith(
      "meatworld-yhz25ler.myshopify.com",
      { name: "Tolo Growth", status: "ACTIVE" },
    );
  });
});
