import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

async function toloAudit(
  shopDomain: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await prisma.toloAuditLog.create({
    data: {
      shopDomain,
      action,
      detail: (detail ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/**
 * customers/data_request — Tolo stores no customer PII (orders are stripped
 * to financial fields at ingest), so there is nothing to hand over. Audited
 * so the response is provable.
 */
export async function toloGdprDataRequest(
  shopDomain: string,
  payload: unknown,
): Promise<void> {
  await toloAudit(shopDomain, "gdpr_data_request", {
    note: "No customer PII stored; nothing to provide.",
    payload,
  });
}

/** customers/redact — same story: nothing customer-identifying to delete. */
export async function toloGdprCustomerRedact(
  shopDomain: string,
  payload: unknown,
): Promise<void> {
  await toloAudit(shopDomain, "gdpr_customer_redact", {
    note: "No customer PII stored; nothing to redact.",
    payload,
  });
}

/** app/uninstalled — mark the shop and schedule the 30-day purge backstop. */
export async function toloMarkUninstalled(shopDomain: string): Promise<void> {
  const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.toloShop.updateMany({
    where: { shopDomain },
    data: { uninstalledAt: new Date(), purgeAfter },
  });
  await prisma.session.deleteMany({ where: { shop: shopDomain } });
  await toloAudit(shopDomain, "shop_redact_scheduled", {
    purgeAfter: purgeAfter.toISOString(),
  });
}

/** shop/redact (or purge backstop) — hard-delete every row for the shop. */
export async function toloPurgeShop(shopDomain: string): Promise<void> {
  const shop = await prisma.toloShop.findUnique({ where: { shopDomain } });
  if (!shop) {
    await toloAudit(shopDomain, "shop_purged", { note: "no data present" });
    return;
  }
  const shopId = shop.id;
  const counts: Record<string, number> = {};

  counts.orderLines = (
    await prisma.toloOrderLine.deleteMany({ where: { shopId } })
  ).count;
  counts.orders = (
    await prisma.toloOrderRecord.deleteMany({ where: { shopId } })
  ).count;
  counts.variants = (
    await prisma.toloVariant.deleteMany({ where: { shopId } })
  ).count;
  counts.costs = (
    await prisma.toloProductCost.deleteMany({ where: { shopId } })
  ).count;
  counts.shippingRules = (
    await prisma.toloShippingRule.deleteMany({ where: { shopId } })
  ).count;
  counts.adSpend = (
    await prisma.toloAdSpendEntry.deleteMany({ where: { shopId } })
  ).count;
  counts.dailyProfits = (
    await prisma.toloDailyProfit.deleteMany({ where: { shopId } })
  ).count;
  counts.productDailyProfits = (
    await prisma.toloProductDailyProfit.deleteMany({ where: { shopId } })
  ).count;
  counts.alertRules = (
    await prisma.toloAlertRule.deleteMany({ where: { shopId } })
  ).count;
  counts.alerts = (await prisma.toloAlert.deleteMany({ where: { shopId } }))
    .count;
  await prisma.session.deleteMany({ where: { shop: shopDomain } });
  await prisma.toloShop.delete({ where: { id: shopId } });

  await toloAudit(shopDomain, "shop_purged", counts);
}
