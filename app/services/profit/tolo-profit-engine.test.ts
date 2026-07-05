import { describe, expect, it } from "vitest";
import {
  toloAllocateAdSpend,
  toloComputeFeeCents,
  toloComputeProfit,
  toloResolveCogsAt,
  toloResolveLineCogs,
  toloResolveShippingCost,
  toloRollupDay,
  TOLO_UNATTRIBUTED,
  type ToloRollupOrder,
  type ToloShippingRuleInput,
} from "./tolo-profit-engine";

const d = (iso: string) => new Date(iso);

describe("toloResolveCogsAt", () => {
  const history = [
    { costCents: 500, effectiveFrom: d("2026-01-01") },
    { costCents: 650, effectiveFrom: d("2026-03-01") },
    { costCents: 700, effectiveFrom: d("2026-06-01") },
  ];

  it.each([
    ["2026-02-15", 500], // old order keeps old cost
    ["2026-03-01", 650], // boundary: effectiveFrom is inclusive
    ["2026-04-10", 650],
    ["2026-12-31", 700], // current cost
  ])("order at %s resolves cost %d", (at, expected) => {
    expect(toloResolveCogsAt(history, d(at))).toBe(expected);
  });

  it("returns null before any cost exists", () => {
    expect(toloResolveCogsAt(history, d("2025-12-31"))).toBeNull();
    expect(toloResolveCogsAt([], d("2026-01-01"))).toBeNull();
  });

  it("is order-insensitive", () => {
    expect(toloResolveCogsAt([...history].reverse(), d("2026-04-01"))).toBe(
      650,
    );
  });
});

describe("toloResolveLineCogs", () => {
  const history = [{ costCents: 250, effectiveFrom: d("2026-01-01") }];

  it("multiplies unit cost by quantity", () => {
    expect(toloResolveLineCogs(history, 3, d("2026-02-01"))).toEqual({
      cogsCents: 750,
      cogsMissing: false,
    });
  });

  it("flags missing cost instead of assuming zero", () => {
    expect(toloResolveLineCogs([], 3, d("2026-02-01"))).toEqual({
      cogsCents: null,
      cogsMissing: true,
    });
  });
});

describe("toloResolveShippingCost (ToloShippingCostResolver)", () => {
  const ctx = { itemCount: 3, totalWeightGrams: 1200, countryCode: "US" };
  const rule = (
    kind: ToloShippingRuleInput["kind"],
    config: unknown,
    priority = 0,
    active = true,
  ): ToloShippingRuleInput => ({ id: `r-${kind}-${priority}`, kind, config, priority, active });

  it("flat_order returns the flat amount", () => {
    const { costCents } = toloResolveShippingCost(
      [rule("flat_order", { amountCents: 799 })],
      ctx,
    );
    expect(costCents).toBe(799);
  });

  it("per_item multiplies by item count", () => {
    const { costCents } = toloResolveShippingCost(
      [rule("per_item", { amountCents: 150 })],
      ctx,
    );
    expect(costCents).toBe(450);
  });

  it("weight_band picks the smallest band that fits", () => {
    const bands = {
      bands: [
        { maxGrams: 500, amountCents: 500 },
        { maxGrams: 2000, amountCents: 900 },
        { maxGrams: null, amountCents: 1500 },
      ],
    };
    expect(
      toloResolveShippingCost([rule("weight_band", bands)], ctx).costCents,
    ).toBe(900);
    expect(
      toloResolveShippingCost([rule("weight_band", bands)], {
        ...ctx,
        totalWeightGrams: 100,
      }).costCents,
    ).toBe(500);
    expect(
      toloResolveShippingCost([rule("weight_band", bands)], {
        ...ctx,
        totalWeightGrams: 99999,
      }).costCents,
    ).toBe(1500);
  });

  it("weight_band with no matching band falls through to next rule", () => {
    const rules = [
      rule("weight_band", { bands: [{ maxGrams: 500, amountCents: 500 }] }, 0),
      rule("flat_order", { amountCents: 777 }, 1),
    ];
    expect(toloResolveShippingCost(rules, ctx).costCents).toBe(777);
  });

  it("zone matches by country, uses default, or falls through", () => {
    const zones = {
      zones: [
        { countries: ["US", "CA"], amountCents: 600 },
        { countries: ["GB"], amountCents: 1200 },
      ],
      defaultCents: 2000,
    };
    expect(toloResolveShippingCost([rule("zone", zones)], ctx).costCents).toBe(
      600,
    );
    expect(
      toloResolveShippingCost([rule("zone", zones)], {
        ...ctx,
        countryCode: "DE",
      }).costCents,
    ).toBe(2000);
    // no default, unknown country → next rule
    const noDefault = { zones: zones.zones };
    expect(
      toloResolveShippingCost(
        [rule("zone", noDefault, 0), rule("flat_order", { amountCents: 300 }, 1)],
        { ...ctx, countryCode: "DE" },
      ).costCents,
    ).toBe(300);
    // no country on the order → default
    expect(
      toloResolveShippingCost([rule("zone", zones)], {
        ...ctx,
        countryCode: null,
      }).costCents,
    ).toBe(2000);
  });

  it("respects priority and skips inactive rules", () => {
    const rules = [
      rule("flat_order", { amountCents: 100 }, 5),
      rule("flat_order", { amountCents: 200 }, 1),
      { ...rule("flat_order", { amountCents: 50 }, 0), active: false },
    ];
    expect(toloResolveShippingCost(rules, ctx).costCents).toBe(200);
  });

  it("skips malformed configs and returns 0 when nothing matches", () => {
    const rules = [
      rule("flat_order", { amountCents: "not-a-number" }),
      rule("per_item", {}),
      rule("weight_band", { bands: "nope" }),
      rule("zone", null),
    ];
    const result = toloResolveShippingCost(rules, ctx);
    expect(result.costCents).toBe(0);
    expect(result.ruleId).toBeNull();
  });
});

describe("toloComputeFeeCents", () => {
  const config = { feeRateBps: 290, feeFixedCents: 30 };

  it("applies rate + fixed on the charged amount", () => {
    // $100 charged → $2.90 + $0.30
    expect(toloComputeFeeCents(10_000, config)).toBe(320);
  });

  it("rounds the rate portion", () => {
    expect(toloComputeFeeCents(999, config)).toBe(29 + 30);
  });

  it("charges nothing on zero or refund-only orders", () => {
    expect(toloComputeFeeCents(0, config)).toBe(0);
    expect(toloComputeFeeCents(-500, config)).toBe(0);
  });
});

describe("toloComputeProfit", () => {
  it("computes the canonical formula", () => {
    const result = toloComputeProfit({
      grossCents: 10_000,
      discountCents: 1_000,
      refundCents: 500,
      cogsCents: 3_000,
      shippingCostCents: 800,
      feeCents: 320,
      adSpendCents: 1_000,
    });
    expect(result.netRevenueCents).toBe(8_500);
    expect(result.totalCostCents).toBe(5_120);
    expect(result.netProfitCents).toBe(3_380);
    expect(result.marginBps).toBe(Math.round((3_380 * 10_000) / 8_500));
  });

  it("reports zero margin when net revenue is zero or negative", () => {
    const zero = toloComputeProfit({
      grossCents: 0,
      discountCents: 0,
      refundCents: 0,
      cogsCents: 0,
      shippingCostCents: 0,
      feeCents: 0,
      adSpendCents: 500,
    });
    expect(zero.marginBps).toBe(0);
    expect(zero.netProfitCents).toBe(-500);

    const negative = toloComputeProfit({
      grossCents: 100,
      discountCents: 0,
      refundCents: 200,
      cogsCents: 0,
      shippingCostCents: 0,
      feeCents: 0,
      adSpendCents: 0,
    });
    expect(negative.netRevenueCents).toBe(-100);
    expect(negative.marginBps).toBe(0);
  });
});

describe("toloAllocateAdSpend", () => {
  it("allocates proportionally to revenue", () => {
    const split = toloAllocateAdSpend(1_000, [
      { productId: "a", revenueCents: 7_500 },
      { productId: "b", revenueCents: 2_500 },
    ]);
    expect(split.get("a")).toBe(750);
    expect(split.get("b")).toBe(250);
  });

  it("treats negative revenue as zero weight", () => {
    const split = toloAllocateAdSpend(1_000, [
      { productId: "a", revenueCents: -500 },
      { productId: "b", revenueCents: 500 },
    ]);
    expect(split.get("a")).toBe(0);
    expect(split.get("b")).toBe(1_000);
  });

  it("handles the no-revenue day", () => {
    const split = toloAllocateAdSpend(1_000, [
      { productId: "a", revenueCents: 0 },
    ]);
    expect(split.get("a")).toBe(0);
  });
});

describe("toloRollupDay", () => {
  const order = (over: Partial<ToloRollupOrder> = {}): ToloRollupOrder => ({
    grossCents: 10_000,
    discountCents: 1_000,
    refundCents: 0,
    feeCents: 300,
    shippingCostCents: 700,
    lines: [
      {
        productId: "prod-1",
        quantity: 2,
        revenueCents: 6_000,
        discountCents: 700,
        refundedQuantity: 0,
        refundedCents: 0,
        cogsCents: 2_000,
        cogsMissing: false,
      },
      {
        productId: "prod-2",
        quantity: 1,
        revenueCents: 3_000,
        discountCents: 300,
        refundedQuantity: 0,
        refundedCents: 0,
        cogsCents: 1_000,
        cogsMissing: false,
      },
    ],
    ...over,
  });

  it("aggregates the day and reconciles product totals", () => {
    const { daily, products } = toloRollupDay([order()], 900);
    expect(daily.grossCents).toBe(10_000);
    expect(daily.netRevenueCents).toBe(9_000);
    expect(daily.cogsCents).toBe(3_000);
    expect(daily.adSpendCents).toBe(900);
    expect(daily.netProfitCents).toBe(9_000 - 3_000 - 700 - 300 - 900);
    expect(daily.ordersCount).toBe(1);
    expect(daily.unitsSold).toBe(3);
    expect(daily.cogsMissingCents).toBe(0);

    const total = products.reduce((sum, p) => sum + p.adSpendCents, 0);
    expect(total).toBe(900); // no lost cents in allocation
    const p1 = products.find((p) => p.productId === "prod-1")!;
    expect(p1.unitsSold).toBe(2);
    expect(p1.grossCents).toBe(6_700);
  });

  it("tracks missing COGS revenue instead of zeroing silently", () => {
    const o = order();
    o.lines[0] = { ...o.lines[0], cogsCents: null, cogsMissing: true };
    const { daily, products } = toloRollupDay([o], 0);
    expect(daily.cogsMissingCents).toBe(6_000);
    expect(daily.cogsCents).toBe(1_000);
    expect(products.find((p) => p.productId === "prod-1")!.cogsMissing).toBe(
      true,
    );
  });

  it("buckets lines without a product as unattributed", () => {
    const o = order();
    o.lines[1] = { ...o.lines[1], productId: null };
    const { products } = toloRollupDay([o], 0);
    expect(products.some((p) => p.productId === TOLO_UNATTRIBUTED)).toBe(true);
  });

  it("handles an empty day with ad spend", () => {
    const { daily, products } = toloRollupDay([], 1_500);
    expect(daily.netProfitCents).toBe(-1_500);
    expect(daily.marginBps).toBe(0);
    expect(products).toEqual([]);
  });

  it("accounts refunds at both levels", () => {
    const o = order({ refundCents: 2_000 });
    o.lines[0] = {
      ...o.lines[0],
      refundedQuantity: 1,
      refundedCents: 2_000,
    };
    const { daily, products } = toloRollupDay([o], 0);
    expect(daily.refundCents).toBe(2_000);
    expect(daily.netRevenueCents).toBe(7_000);
    const p1 = products.find((p) => p.productId === "prod-1")!;
    expect(p1.refundCents).toBe(2_000);
    expect(p1.refundedUnits).toBe(1);
  });
});
