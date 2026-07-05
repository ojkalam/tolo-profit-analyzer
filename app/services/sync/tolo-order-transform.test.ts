import { describe, expect, it } from "vitest";
import { toloTransformOrder, type ToloRawOrder } from "./tolo-order-transform";

const money = (amount: string) => ({ shopMoney: { amount } });

const rawOrder = (over: Partial<ToloRawOrder> = {}): ToloRawOrder => ({
  id: "gid://shopify/Order/100",
  name: "#1001",
  processedAt: "2026-06-15T14:30:00Z",
  cancelledAt: null,
  test: false,
  currencyCode: "USD",
  totalWeight: "2500",
  shippingAddress: { countryCodeV2: "US" },
  discountCodes: ["SUMMER20"],
  totalDiscountsSet: money("10.00"),
  totalShippingPriceSet: money("5.00"),
  totalRefundedSet: money("0.00"),
  lineItems: {
    nodes: [
      {
        id: "gid://shopify/LineItem/1",
        title: "Ribeye",
        quantity: 2,
        product: { id: "gid://shopify/Product/10" },
        variant: { id: "gid://shopify/ProductVariant/20" },
        originalTotalSet: money("40.00"),
        discountAllocations: [{ allocatedAmountSet: money("8.00") }],
      },
      {
        id: "gid://shopify/LineItem/2",
        title: "Brisket",
        quantity: 1,
        product: { id: "gid://shopify/Product/11" },
        variant: { id: "gid://shopify/ProductVariant/21" },
        originalTotalSet: money("10.00"),
        discountAllocations: [{ allocatedAmountSet: money("2.00") }],
      },
    ],
  },
  refunds: [],
  ...over,
});

describe("toloTransformOrder", () => {
  it("maps a full order to integer cents", () => {
    const order = toloTransformOrder(rawOrder());
    expect(order.shopifyOrderId).toBe("gid://shopify/Order/100");
    expect(order.grossCents).toBe(5000);
    expect(order.discountCents).toBe(1000);
    expect(order.shippingChargedCents).toBe(500);
    expect(order.totalWeightGrams).toBe(2500);
    expect(order.countryCode).toBe("US");
    expect(order.discountCodes).toEqual(["SUMMER20"]);
    expect(order.cancelled).toBe(false);

    const [ribeye, brisket] = order.lines;
    expect(ribeye.revenueCents).toBe(3200); // 40.00 − 8.00 allocated
    expect(ribeye.discountCents).toBe(800);
    expect(brisket.revenueCents).toBe(800);
  });

  it("applies per-line refund detail when refund objects exist", () => {
    const order = toloTransformOrder(
      rawOrder({
        totalRefundedSet: money("16.00"),
        refunds: [
          {
            id: "gid://shopify/Refund/1",
            totalRefundedSet: money("16.00"),
            refundLineItems: {
              nodes: [
                {
                  quantity: 1,
                  subtotalSet: money("16.00"),
                  lineItem: { id: "gid://shopify/LineItem/1" },
                },
              ],
            },
          },
        ],
      }),
    );
    expect(order.refundCents).toBe(1600);
    expect(order.lines[0].refundedQuantity).toBe(1);
    expect(order.lines[0].refundedCents).toBe(1600);
    expect(order.lines[1].refundedCents).toBe(0);
  });

  it("falls back to summed refund objects when the order total is absent", () => {
    const order = toloTransformOrder(
      rawOrder({
        totalRefundedSet: money("0"),
        refunds: [
          {
            id: "gid://shopify/Refund/1",
            totalRefundedSet: money("7.50"),
          },
        ],
      }),
    );
    expect(order.refundCents).toBe(750);
  });

  it("flags cancelled orders and handles bulk-shaped minimal data", () => {
    const order = toloTransformOrder(
      rawOrder({
        cancelledAt: "2026-06-16T00:00:00Z",
        refunds: undefined,
        totalWeight: null,
        shippingAddress: null,
        discountCodes: null,
      }),
    );
    expect(order.cancelled).toBe(true);
    expect(order.totalWeightGrams).toBe(0);
    expect(order.countryCode).toBeNull();
    expect(order.discountCodes).toEqual([]);
  });
});
