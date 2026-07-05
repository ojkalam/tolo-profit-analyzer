import { describe, expect, it } from "vitest";
import {
  toloApportionCents,
  toloDecimalToCents,
  toloFormatBps,
  toloFormatCents,
} from "./tolo-money";

describe("toloDecimalToCents", () => {
  const cases: Array<[string | null | undefined, number]> = [
    ["12.34", 1234],
    ["12", 1200],
    ["12.5", 1250],
    ["0.01", 1],
    ["0", 0],
    ["", 0],
    [null, 0],
    [undefined, 0],
    ["-12.34", -1234],
    ["1234567.89", 123456789],
    ["12.345", 1235], // rounds half-up on 3rd digit
    ["12.344", 1234],
    [".5", 50],
    ["12.", 1200],
  ];
  it.each(cases)("parses %j to %d cents", (input, expected) => {
    expect(toloDecimalToCents(input)).toBe(expected);
  });

  it("throws on garbage", () => {
    expect(() => toloDecimalToCents("12,34")).toThrow(/unparseable/);
    expect(() => toloDecimalToCents("abc")).toThrow(/unparseable/);
  });
});

describe("toloFormatCents / toloFormatBps", () => {
  it("formats at the UI edge", () => {
    expect(toloFormatCents(123456, "USD")).toBe("$1,234.56");
    expect(toloFormatCents(-5000, "USD")).toBe("-$50.00");
    expect(toloFormatBps(2534)).toBe("25.3%");
    expect(toloFormatBps(-500)).toBe("-5.0%");
  });
});

describe("toloApportionCents", () => {
  it("splits proportionally without losing cents", () => {
    const split = toloApportionCents(100, [1, 1, 1]);
    expect(split.reduce((a, b) => a + b, 0)).toBe(100);
    expect(split).toEqual([34, 33, 33]);
  });

  it("handles zero weights", () => {
    expect(toloApportionCents(100, [0, 0])).toEqual([0, 0]);
    expect(toloApportionCents(100, [])).toEqual([]);
  });

  it("gives everything to a single weight", () => {
    expect(toloApportionCents(999, [5])).toEqual([999]);
  });

  it("apportions by weight", () => {
    expect(toloApportionCents(1000, [750, 250])).toEqual([750, 250]);
    const uneven = toloApportionCents(1001, [750, 250]);
    expect(uneven.reduce((a, b) => a + b, 0)).toBe(1001);
  });
});
