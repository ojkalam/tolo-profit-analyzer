import { describe, expect, it } from "vitest";
import { toloDetectMarginAnomaly } from "./tolo-profit-engine";

describe("toloDetectMarginAnomaly", () => {
  it("needs at least 5 points", () => {
    expect(toloDetectMarginAnomaly([2500, 2500, 2500, 2000]).isAnomaly).toBe(
      false,
    );
  });

  it("flags a sharp drop below a stable baseline", () => {
    // Baseline ~25% margin, then a crash to 5%.
    const result = toloDetectMarginAnomaly([
      2500, 2450, 2550, 2500, 2480, 500,
    ]);
    expect(result.isAnomaly).toBe(true);
    expect(result.latestBps).toBe(500);
    expect(result.zScore).toBeLessThan(-2);
  });

  it("does not flag normal variation", () => {
    const result = toloDetectMarginAnomaly([
      2500, 2400, 2600, 2450, 2550, 2500,
    ]);
    expect(result.isAnomaly).toBe(false);
  });

  it("ignores tiny gaps even when the baseline is flat", () => {
    // Flat baseline, latest differs by less than minGapBps (500).
    const result = toloDetectMarginAnomaly([3000, 3000, 3000, 3000, 3200]);
    expect(result.isAnomaly).toBe(false);
  });

  it("flags a large gap against a perfectly flat baseline", () => {
    const result = toloDetectMarginAnomaly([3000, 3000, 3000, 3000, 1000]);
    expect(result.isAnomaly).toBe(true);
    expect(result.stdDevBps).toBe(0);
  });

  it("flags a large positive gap against a flat baseline (+Infinity z)", () => {
    const result = toloDetectMarginAnomaly([2000, 2000, 2000, 2000, 4000]);
    expect(result.isAnomaly).toBe(true);
    expect(result.stdDevBps).toBe(0);
    expect(result.zScore).toBe(Infinity);
  });

  it("flags positive spikes too (caller decides direction)", () => {
    const result = toloDetectMarginAnomaly([
      1000, 1050, 950, 1000, 1020, 4000,
    ]);
    expect(result.isAnomaly).toBe(true);
    expect(result.zScore).toBeGreaterThan(2);
  });
});
