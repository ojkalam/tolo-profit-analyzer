// Pure transform: raw Admin API order JSON (direct query or reassembled bulk
// JSONL) → normalized integer-cent shape. No I/O here; enrichment (COGS,
// shipping cost, fees) happens in the sync service via ToloProfitEngine.

import { toloDecimalToCents } from "../profit/tolo-money";

interface ToloMoneySet {
  shopMoney?: { amount?: string | null } | null;
}

export interface ToloRawLineItem {
  id: string;
  title?: string | null;
  quantity: number;
  product?: { id: string } | null;
  variant?: { id: string } | null;
  originalTotalSet?: ToloMoneySet | null;
  discountAllocations?: Array<{
    allocatedAmountSet?: ToloMoneySet | null;
  }> | null;
}

export interface ToloRawRefund {
  id: string;
  totalRefundedSet?: ToloMoneySet | null;
  refundLineItems?: {
    nodes?: Array<{
      quantity: number;
      subtotalSet?: ToloMoneySet | null;
      lineItem?: { id: string } | null;
    }> | null;
  } | null;
}

export interface ToloRawOrder {
  id: string;
  name?: string | null;
  processedAt: string;
  cancelledAt?: string | null;
  test?: boolean | null;
  currencyCode?: string | null;
  totalWeight?: string | number | null;
  shippingAddress?: { countryCodeV2?: string | null } | null;
  discountCodes?: string[] | null;
  totalDiscountsSet?: ToloMoneySet | null;
  totalShippingPriceSet?: ToloMoneySet | null;
  totalRefundedSet?: ToloMoneySet | null;
  lineItems?: { nodes?: ToloRawLineItem[] | null } | null;
  refunds?: ToloRawRefund[] | null;
}

export interface ToloNormalizedLine {
  shopifyLineItemId: string;
  variantId: string | null;
  productId: string | null;
  title: string | null;
  quantity: number;
  /** After all allocated discounts (line + order level). */
  revenueCents: number;
  discountCents: number;
  refundedQuantity: number;
  refundedCents: number;
}

export interface ToloNormalizedOrder {
  shopifyOrderId: string;
  orderNumber: string | null;
  processedAt: Date;
  cancelled: boolean;
  test: boolean;
  currency: string;
  countryCode: string | null;
  totalWeightGrams: number;
  discountCodes: string[];
  grossCents: number;
  discountCents: number;
  refundCents: number;
  shippingChargedCents: number;
  lines: ToloNormalizedLine[];
}

const money = (set: ToloMoneySet | null | undefined): number =>
  toloDecimalToCents(set?.shopMoney?.amount ?? null);

export function toloTransformOrder(raw: ToloRawOrder): ToloNormalizedOrder {
  const lineNodes = raw.lineItems?.nodes ?? [];

  // Refund detail per line item (may be absent in bulk-imported history).
  const refundedByLine = new Map<
    string,
    { quantity: number; cents: number }
  >();
  let refundTotalCents = money(raw.totalRefundedSet);
  let refundFromObjects = 0;
  for (const refund of raw.refunds ?? []) {
    refundFromObjects += money(refund.totalRefundedSet);
    for (const rli of refund.refundLineItems?.nodes ?? []) {
      const lineId = rli.lineItem?.id;
      if (!lineId) continue;
      const entry = refundedByLine.get(lineId) ?? { quantity: 0, cents: 0 };
      entry.quantity += rli.quantity;
      entry.cents += money(rli.subtotalSet);
      refundedByLine.set(lineId, entry);
    }
  }
  // Prefer the order-level total; fall back to summed refund objects.
  if (refundTotalCents === 0 && refundFromObjects > 0) {
    refundTotalCents = refundFromObjects;
  }

  const lines: ToloNormalizedLine[] = lineNodes.map((node) => {
    const originalCents = money(node.originalTotalSet);
    const discountCents = (node.discountAllocations ?? []).reduce(
      (sum, alloc) => sum + money(alloc.allocatedAmountSet),
      0,
    );
    const refunded = refundedByLine.get(node.id);
    return {
      shopifyLineItemId: node.id,
      variantId: node.variant?.id ?? null,
      productId: node.product?.id ?? null,
      title: node.title ?? null,
      quantity: node.quantity,
      revenueCents: originalCents - discountCents,
      discountCents,
      refundedQuantity: refunded?.quantity ?? 0,
      refundedCents: refunded?.cents ?? 0,
    };
  });

  const grossCents = lines.reduce(
    (sum, line) => sum + line.revenueCents + line.discountCents,
    0,
  );
  const discountCents = money(raw.totalDiscountsSet);

  return {
    shopifyOrderId: raw.id,
    orderNumber: raw.name ?? null,
    processedAt: new Date(raw.processedAt),
    cancelled: raw.cancelledAt != null,
    test: raw.test ?? false,
    currency: raw.currencyCode ?? "USD",
    countryCode: raw.shippingAddress?.countryCodeV2 ?? null,
    totalWeightGrams: Math.round(Number(raw.totalWeight ?? 0)) || 0,
    discountCodes: raw.discountCodes ?? [],
    grossCents,
    discountCents,
    refundCents: refundTotalCents,
    shippingChargedCents: money(raw.totalShippingPriceSet),
    lines,
  };
}
