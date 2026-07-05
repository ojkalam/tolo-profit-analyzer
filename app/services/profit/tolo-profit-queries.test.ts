import { describe, expect, it } from "vitest";
import type { ToloShop } from "@prisma/client";
import {
  toloPreviousRange,
  toloResolveRange,
} from "./tolo-profit-queries.server";

// Only the pure range helpers are tested here; DB-backed queries are covered
// via integration paths. Freeze "now" through the shop timezone by picking a
// tz far from date boundaries is unnecessary — we assert relative structure.
const shop = { ianaTimezone: "UTC" } as ToloShop;

describe("toloResolveRange", () => {
  it("today is a single day", () => {
    const r = toloResolveRange(shop, "today");
    expect(r.from).toBe(r.to);
  });

  it("7d and 30d span the right number of days", () => {
    const r7 = toloResolveRange(shop, "7d");
    const days7 =
      (Date.parse(r7.to) - Date.parse(r7.from)) / 86_400_000 + 1;
    expect(days7).toBe(7);

    const r30 = toloResolveRange(shop, "30d");
    const days30 =
      (Date.parse(r30.to) - Date.parse(r30.from)) / 86_400_000 + 1;
    expect(days30).toBe(30);
  });

  it("custom honors explicit bounds", () => {
    const r = toloResolveRange(shop, "custom", {
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(r).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });
});

describe("toloPreviousRange", () => {
  it("returns the equal-length window immediately before", () => {
    const prev = toloPreviousRange({ from: "2026-06-08", to: "2026-06-14" });
    expect(prev).toEqual({ from: "2026-06-01", to: "2026-06-07" });
  });

  it("handles a single-day range", () => {
    const prev = toloPreviousRange({ from: "2026-06-14", to: "2026-06-14" });
    expect(prev).toEqual({ from: "2026-06-13", to: "2026-06-13" });
  });
});
