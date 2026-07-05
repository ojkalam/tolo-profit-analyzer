import prisma from "../../db.server";
import { toloEnqueue } from "../../jobs/tolo-queue.server";
import { toloAddDays, toloDayKey } from "../tolo-dates";
import { toloDecimalToCents } from "../profit/tolo-money";
import { toloResolveCogsAt } from "../profit/tolo-profit-engine";

export interface ToloVariantCostRow {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  priceCents: number;
  currentCostCents: number | null;
  source: string | null;
  effectiveFrom: string | null;
  hasCost: boolean;
}

/**
 * All variants with their currently-effective cost (newest history row whose
 * effectiveFrom <= now) for the bulk COGS editor.
 */
export async function toloListVariantCosts(
  shopId: string,
): Promise<ToloVariantCostRow[]> {
  const [variants, costs] = await Promise.all([
    prisma.toloVariant.findMany({
      where: { shopId },
      orderBy: [{ productTitle: "asc" }, { variantTitle: "asc" }],
    }),
    prisma.toloProductCost.findMany({
      where: { shopId },
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);

  const byVariant = new Map<string, typeof costs>();
  for (const cost of costs) {
    const list = byVariant.get(cost.variantId) ?? [];
    list.push(cost);
    byVariant.set(cost.variantId, list);
  }

  const now = new Date();
  return variants.map((variant) => {
    const history = byVariant.get(variant.variantId) ?? [];
    const effective = history
      .filter((row) => row.effectiveFrom.getTime() <= now.getTime())
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    return {
      variantId: variant.variantId,
      productId: variant.productId,
      productTitle: variant.productTitle,
      variantTitle: variant.variantTitle,
      sku: variant.sku,
      priceCents: variant.priceCents,
      currentCostCents: effective?.costCents ?? null,
      source: effective?.source ?? null,
      effectiveFrom: effective
        ? effective.effectiveFrom.toISOString().slice(0, 10)
        : null,
      hasCost: effective != null,
    };
  });
}

export interface ToloSetCostInput {
  variantId: string;
  productId: string;
  costCents: number;
  effectiveFrom?: Date;
  source?: "manual" | "csv";
}

/**
 * Record a new cost. Edits are append-only history rows (CLAUDE.md 2.1);
 * backdating is supported and triggers a recompute of the affected range.
 */
export async function toloSetCost(
  shopDomain: string,
  shopId: string,
  input: ToloSetCostInput,
): Promise<void> {
  const effectiveFrom = input.effectiveFrom ?? new Date();
  await prisma.toloProductCost.create({
    data: {
      shopId,
      variantId: input.variantId,
      productId: input.productId,
      costCents: input.costCents,
      effectiveFrom,
      source: input.source ?? "manual",
    },
  });

  // Recompute from the cost's effective day forward (backdating recomputes
  // history), debounced so a bulk edit collapses into one pass.
  const shop = await prisma.toloShop.findUnique({ where: { id: shopId } });
  const from = toloDayKey(effectiveFrom, shop?.ianaTimezone ?? "UTC");
  await toloEnqueue(
    "tolo:rollup",
    { shopDomain, from },
    { dedupeId: `tolo:rollup:${shopDomain}:costedit`, delayMs: 4_000 },
  );
  await toloEnqueue(
    "tolo:alert-scan",
    { shopDomain },
    { dedupeId: `tolo:alert-scan:${shopDomain}`, delayMs: 20_000 },
  );
}

export interface ToloCompleteness {
  variantsTotal: number;
  variantsWithCost: number;
  catalogPct: number;
  revenueCoveredCents: number;
  revenueTotalCents: number;
  revenuePct: number;
}

/**
 * Cost Completeness Meter: share of catalog with a cost, and share of the
 * trailing-30-day revenue whose lines have a known COGS (CLAUDE.md 2.1).
 */
export async function toloCostCompleteness(
  shopId: string,
  ianaTimezone: string,
): Promise<ToloCompleteness> {
  const variants = await prisma.toloVariant.findMany({
    where: { shopId },
    select: { variantId: true },
  });
  const variantsTotal = variants.length;

  const costRows = await prisma.toloProductCost.findMany({
    where: { shopId },
    select: { variantId: true, costCents: true, effectiveFrom: true },
  });
  const histories = new Map<
    string,
    Array<{ costCents: number; effectiveFrom: Date }>
  >();
  for (const row of costRows) {
    const list = histories.get(row.variantId) ?? [];
    list.push(row);
    histories.set(row.variantId, list);
  }
  const now = new Date();
  const variantsWithCost = variants.filter(
    (v) => toloResolveCogsAt(histories.get(v.variantId) ?? [], now) != null,
  ).length;

  const today = toloDayKey(now, ianaTimezone);
  const from = toloAddDays(today, -30);
  const lines = await prisma.toloOrderLine.findMany({
    where: { shopId, orderRecord: { day: { gte: from }, test: false } },
    select: { revenueCents: true, cogsMissing: true },
  });
  let revenueTotalCents = 0;
  let revenueCoveredCents = 0;
  for (const line of lines) {
    revenueTotalCents += line.revenueCents;
    if (!line.cogsMissing) revenueCoveredCents += line.revenueCents;
  }

  return {
    variantsTotal,
    variantsWithCost,
    catalogPct:
      variantsTotal > 0
        ? Math.round((variantsWithCost / variantsTotal) * 100)
        : 0,
    revenueCoveredCents,
    revenueTotalCents,
    revenuePct:
      revenueTotalCents > 0
        ? Math.round((revenueCoveredCents / revenueTotalCents) * 100)
        : 0,
  };
}

export interface ToloCsvCostRow {
  key: string; // sku or variant gid
  costCents: number;
}

/**
 * Parse a cost-import CSV. Accepts headers sku/variant_id + cost (dollars).
 * Pure — returns rows and per-line errors; the action resolves keys to
 * variants and writes.
 */
export function toloParseCostCsv(text: string): {
  rows: ToloCsvCostRow[];
  errors: string[];
} {
  const rows: ToloCsvCostRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { rows, errors: ["CSV is empty"] };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const keyIdx = header.findIndex((h) =>
    ["sku", "variant_id", "variantid", "variant"].includes(h),
  );
  const costIdx = header.findIndex((h) =>
    ["cost", "unit_cost", "cost_per_item", "costcents"].includes(h),
  );
  if (keyIdx === -1 || costIdx === -1) {
    return {
      rows,
      errors: ["CSV needs a sku (or variant_id) column and a cost column"],
    };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const key = (cells[keyIdx] ?? "").trim();
    const rawCost = (cells[costIdx] ?? "").trim();
    if (!key) continue;
    try {
      const costCents = toloDecimalToCents(rawCost);
      rows.push({ key, costCents });
    } catch {
      errors.push(`Row ${i + 1}: unparseable cost "${rawCost}"`);
    }
  }
  return { rows, errors };
}

/** Apply parsed CSV rows, resolving sku/variant keys to catalog variants. */
export async function toloApplyCsvCosts(
  shopDomain: string,
  shopId: string,
  rows: ToloCsvCostRow[],
): Promise<{ applied: number; unmatched: string[] }> {
  const variants = await prisma.toloVariant.findMany({
    where: { shopId },
    select: { variantId: true, productId: true, sku: true },
  });
  const bySku = new Map(
    variants.filter((v) => v.sku).map((v) => [v.sku!.toLowerCase(), v]),
  );
  const byGid = new Map(variants.map((v) => [v.variantId, v]));

  let applied = 0;
  const unmatched: string[] = [];
  for (const row of rows) {
    const variant =
      byGid.get(row.key) ??
      byGid.get(`gid://shopify/ProductVariant/${row.key}`) ??
      bySku.get(row.key.toLowerCase());
    if (!variant) {
      unmatched.push(row.key);
      continue;
    }
    await toloSetCost(shopDomain, shopId, {
      variantId: variant.variantId,
      productId: variant.productId,
      costCents: row.costCents,
      source: "csv",
    });
    applied += 1;
  }
  return { applied, unmatched };
}
