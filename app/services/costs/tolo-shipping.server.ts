import type { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { toloEnqueue } from "../../jobs/tolo-queue.server";
import {
  toloResolveShippingCost,
  type ToloShippingRuleInput,
  type ToloShippingRuleKind,
} from "../profit/tolo-profit-engine";

export interface ToloShippingRuleView {
  id: string;
  kind: ToloShippingRuleKind;
  config: unknown;
  priority: number;
  active: boolean;
}

export async function toloListShippingRules(
  shopId: string,
): Promise<ToloShippingRuleView[]> {
  const rules = await prisma.toloShippingRule.findMany({
    where: { shopId },
    orderBy: { priority: "asc" },
  });
  return rules.map((rule) => ({
    id: rule.id,
    kind: rule.kind as ToloShippingRuleKind,
    config: rule.config,
    priority: rule.priority,
    active: rule.active,
  }));
}

const TOLO_RULE_KINDS: ToloShippingRuleKind[] = [
  "flat_order",
  "per_item",
  "weight_band",
  "zone",
];

/** Validate + normalize a rule config by kind. Throws on malformed input. */
export function toloValidateShippingConfig(
  kind: ToloShippingRuleKind,
  config: unknown,
): Prisma.InputJsonValue {
  const record = (config ?? {}) as Record<string, unknown>;
  const cents = (v: unknown) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0) throw new Error("amount must be ≥ 0");
    return n;
  };
  switch (kind) {
    case "flat_order":
    case "per_item":
      return { amountCents: cents(record.amountCents) };
    case "weight_band": {
      const bands = Array.isArray(record.bands) ? record.bands : [];
      if (bands.length === 0) throw new Error("add at least one weight band");
      return {
        bands: bands.map((b) => {
          const band = b as Record<string, unknown>;
          return {
            maxGrams:
              band.maxGrams == null || band.maxGrams === ""
                ? null
                : Math.round(Number(band.maxGrams)),
            amountCents: cents(band.amountCents),
          };
        }),
      };
    }
    case "zone": {
      const zones = Array.isArray(record.zones) ? record.zones : [];
      if (zones.length === 0) throw new Error("add at least one zone");
      return {
        zones: zones.map((z) => {
          const zone = z as Record<string, unknown>;
          const countries = String(zone.countries ?? "")
            .split(",")
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean);
          return { countries, amountCents: cents(zone.amountCents) };
        }),
        defaultCents:
          record.defaultCents == null || record.defaultCents === ""
            ? undefined
            : cents(record.defaultCents),
      };
    }
    default:
      throw new Error(`unknown rule kind ${kind}`);
  }
}

export async function toloSaveShippingRule(
  shopDomain: string,
  shopId: string,
  input: {
    id?: string;
    kind: ToloShippingRuleKind;
    config: unknown;
    priority: number;
    active: boolean;
  },
): Promise<void> {
  if (!TOLO_RULE_KINDS.includes(input.kind)) {
    throw new Error(`unknown rule kind ${input.kind}`);
  }
  const config = toloValidateShippingConfig(input.kind, input.config);
  if (input.id) {
    await prisma.toloShippingRule.update({
      where: { id: input.id },
      data: {
        kind: input.kind,
        config,
        priority: input.priority,
        active: input.active,
      },
    });
  } else {
    await prisma.toloShippingRule.create({
      data: {
        shopId,
        kind: input.kind,
        config,
        priority: input.priority,
        active: input.active,
      },
    });
  }
  await toloEnqueueShippingRecompute(shopDomain);
}

export async function toloDeleteShippingRule(
  shopDomain: string,
  id: string,
): Promise<void> {
  await prisma.toloShippingRule.delete({ where: { id } });
  await toloEnqueueShippingRecompute(shopDomain);
}

// A shipping-rule change alters resolved shipping cost on future rollups; the
// stored per-order shippingCostCents is refreshed on next order sync, and the
// rollup recomputes margins. Recompute a wide recent window.
async function toloEnqueueShippingRecompute(shopDomain: string): Promise<void> {
  await toloEnqueue(
    "tolo:rollup",
    { shopDomain },
    { dedupeId: `tolo:rollup:${shopDomain}:shipping`, delayMs: 4_000 },
  );
}

export interface ToloShippingPreviewInput {
  itemCount: number;
  totalWeightGrams: number;
  countryCode: string | null;
}

/** "Test an order" preview for the rule builder. */
export function toloPreviewShipping(
  rules: ToloShippingRuleView[],
  order: ToloShippingPreviewInput,
): { costCents: number; ruleId: string | null } {
  const inputs: ToloShippingRuleInput[] = rules.map((rule) => ({
    id: rule.id,
    kind: rule.kind,
    config: rule.config,
    priority: rule.priority,
    active: rule.active,
  }));
  return toloResolveShippingCost(inputs, order);
}
