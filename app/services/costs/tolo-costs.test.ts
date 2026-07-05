import { describe, expect, it } from "vitest";
import { toloParseCostCsv } from "./tolo-costs.server";
import { toloValidateShippingConfig } from "./tolo-shipping.server";

describe("toloParseCostCsv", () => {
  it("parses sku + cost with dollar amounts", () => {
    const { rows, errors } = toloParseCostCsv(
      "sku,cost\nRIBEYE-12,8.50\nBRISKET-1,12\n",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { key: "RIBEYE-12", costCents: 850 },
      { key: "BRISKET-1", costCents: 1200 },
    ]);
  });

  it("accepts variant_id and unit_cost header aliases", () => {
    const { rows } = toloParseCostCsv("variant_id,unit_cost\n12345,3.33");
    expect(rows).toEqual([{ key: "12345", costCents: 333 }]);
  });

  it("rejects a CSV missing required columns", () => {
    const { errors } = toloParseCostCsv("name,price\nfoo,1.00");
    expect(errors[0]).toMatch(/needs a sku/);
  });

  it("collects per-row errors for bad costs", () => {
    const { rows, errors } = toloParseCostCsv("sku,cost\nA,1.00\nB,abc");
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatch(/Row 3/);
  });

  it("reports an empty CSV", () => {
    expect(toloParseCostCsv("").errors[0]).toMatch(/empty/);
  });
});

describe("toloValidateShippingConfig", () => {
  it("normalizes flat and per-item amounts", () => {
    expect(
      toloValidateShippingConfig("flat_order", { amountCents: 799 }),
    ).toEqual({ amountCents: 799 });
    expect(
      toloValidateShippingConfig("per_item", { amountCents: "150" }),
    ).toEqual({ amountCents: 150 });
  });

  it("rejects negative or non-numeric amounts", () => {
    expect(() =>
      toloValidateShippingConfig("flat_order", { amountCents: -1 }),
    ).toThrow(/≥ 0/);
    expect(() =>
      toloValidateShippingConfig("flat_order", { amountCents: "x" }),
    ).toThrow();
  });

  it("normalizes weight bands and requires at least one", () => {
    const config = toloValidateShippingConfig("weight_band", {
      bands: [
        { maxGrams: "500", amountCents: 500 },
        { maxGrams: "", amountCents: 1200 },
      ],
    }) as { bands: Array<{ maxGrams: number | null; amountCents: number }> };
    expect(config.bands[0]).toEqual({ maxGrams: 500, amountCents: 500 });
    expect(config.bands[1].maxGrams).toBeNull();
    expect(() =>
      toloValidateShippingConfig("weight_band", { bands: [] }),
    ).toThrow(/weight band/);
  });

  it("normalizes zones (country CSV → array) and optional default", () => {
    const config = toloValidateShippingConfig("zone", {
      zones: [{ countries: "us, ca", amountCents: 600 }],
      defaultCents: 1500,
    }) as {
      zones: Array<{ countries: string[]; amountCents: number }>;
      defaultCents?: number;
    };
    expect(config.zones[0].countries).toEqual(["US", "CA"]);
    expect(config.defaultCents).toBe(1500);
    expect(() =>
      toloValidateShippingConfig("zone", { zones: [] }),
    ).toThrow(/zone/);
  });
});
