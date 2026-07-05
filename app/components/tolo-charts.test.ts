import { describe, expect, it } from "vitest";
import { toloWaterfallSteps } from "./tolo-charts";

describe("toloWaterfallSteps", () => {
  it("builds revenue → costs → profit in order with correct signs", () => {
    const steps = toloWaterfallSteps({
      grossCents: 10_000,
      discountCents: 1_000,
      refundCents: 500,
      cogsCents: 3_000,
      shippingCostCents: 800,
      feeCents: 320,
      adSpendCents: 1_000,
      netProfitCents: 3_380,
    });
    expect(steps.map((s) => s.label)).toEqual([
      "Revenue",
      "Discounts",
      "Refunds",
      "COGS",
      "Shipping",
      "Fees",
      "Ad spend",
      "Net profit",
    ]);
    expect(steps[0]).toMatchObject({ deltaCents: 10_000, kind: "total" });
    expect(steps[1]).toMatchObject({ deltaCents: -1_000, kind: "cost" });
    expect(steps[7]).toMatchObject({ deltaCents: 3_380, kind: "result" });
    // The running total from revenue minus every cost equals net profit.
    const running = steps
      .slice(0, 7)
      .reduce((sum, s) => sum + s.deltaCents, 0);
    expect(running).toBe(steps[7].deltaCents);
  });
});
