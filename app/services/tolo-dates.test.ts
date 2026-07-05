import { describe, expect, it } from "vitest";
import {
  toloAddDays,
  toloDayKey,
  toloDaysInMonth,
  toloEnumerateDays,
  toloLocalHour,
  toloLocalIsoWeekday,
  toloWeekKey,
} from "./tolo-dates";

describe("toloDayKey", () => {
  it("keys by shop-local day, not UTC", () => {
    const instant = new Date("2026-07-05T03:00:00Z");
    expect(toloDayKey(instant, "UTC")).toBe("2026-07-05");
    // 3am UTC is still July 4th in New York.
    expect(toloDayKey(instant, "America/New_York")).toBe("2026-07-04");
    expect(toloDayKey(instant, "Australia/Sydney")).toBe("2026-07-05");
  });
});

describe("toloLocalHour / toloLocalIsoWeekday", () => {
  it("resolves local clock values", () => {
    const instant = new Date("2026-07-06T12:00:00Z"); // a Monday
    expect(toloLocalHour(instant, "UTC")).toBe(12);
    expect(toloLocalIsoWeekday(instant, "UTC")).toBe(1);
    expect(toloLocalIsoWeekday(new Date("2026-07-05T12:00:00Z"), "UTC")).toBe(
      7,
    );
  });
});

describe("day arithmetic", () => {
  it("adds and enumerates across month boundaries", () => {
    expect(toloAddDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(toloAddDays("2026-07-01", -1)).toBe("2026-06-30");
    expect(toloAddDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(toloEnumerateDays("2026-06-29", "2026-07-02")).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
    ]);
    expect(toloEnumerateDays("2026-07-02", "2026-07-01")).toEqual([]);
  });

  it("knows month lengths", () => {
    expect(toloDaysInMonth("2026-02")).toBe(28);
    expect(toloDaysInMonth("2028-02")).toBe(29);
    expect(toloDaysInMonth("2026-07")).toBe(31);
  });
});

describe("toloWeekKey", () => {
  it("computes ISO week keys", () => {
    expect(toloWeekKey("2026-07-05")).toBe("2026-W27");
    expect(toloWeekKey("2026-01-01")).toBe("2026-W01");
    // Jan 1 2027 is a Friday → ISO week 53 of 2026.
    expect(toloWeekKey("2027-01-01")).toBe("2026-W53");
  });
});
