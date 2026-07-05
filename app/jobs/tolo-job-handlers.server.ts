import prisma from "../db.server";
import { toloEnqueue, type ToloJobName, type ToloJobPayloads } from "./tolo-queue.server";
import { toloSyncOrder } from "../services/sync/tolo-order-sync.server";
import { toloSyncCatalog } from "../services/sync/tolo-catalog-sync.server";
import {
  toloPollBulkImport,
  toloStartBulkImport,
} from "../services/sync/tolo-bulk-import.server";
import { toloReconcileShop } from "../services/sync/tolo-reconcile.server";
import { toloRollupRange } from "../services/profit/tolo-rollup.server";
import { toloScanAlerts } from "../services/alerts/tolo-alerts.server";
import { toloSendWeeklyEmails } from "../services/reports/tolo-weekly-email.server";
import {
  toloGdprCustomerRedact,
  toloPurgeShop,
} from "../services/tolo-gdpr.server";

async function toloActiveShopDomains(): Promise<string[]> {
  const shops = await prisma.toloShop.findMany({
    where: { uninstalledAt: null },
    select: { shopDomain: true },
  });
  return shops.map((shop) => shop.shopDomain);
}

/** Purge shops whose 30-day post-uninstall backstop has lapsed. */
async function toloPurgeLapsedShops(): Promise<void> {
  const lapsed = await prisma.toloShop.findMany({
    where: { purgeAfter: { lte: new Date() } },
    select: { shopDomain: true },
  });
  for (const shop of lapsed) {
    await toloEnqueue("tolo:shop-purge", { shopDomain: shop.shopDomain });
  }
}

type ToloHandlerMap = {
  [N in ToloJobName]: (payload: ToloJobPayloads[N]) => Promise<void>;
};

const toloJobHandlers: ToloHandlerMap = {
  "tolo:order-sync": (p) => toloSyncOrder(p.shopDomain, p.orderId),
  "tolo:catalog-sync": (p) => toloSyncCatalog(p.shopDomain, p.productId),
  "tolo:bulk-import": (p) => toloStartBulkImport(p.shopDomain, p.months),
  "tolo:bulk-import-poll": (p) => toloPollBulkImport(p.shopDomain),
  "tolo:rollup": (p) => toloRollupRange(p.shopDomain, p.from, p.to),
  "tolo:rollup-all": async () => {
    await toloPurgeLapsedShops();
    for (const shopDomain of await toloActiveShopDomains()) {
      await toloEnqueue("tolo:rollup", { shopDomain });
      // Alert scan runs after the rollup has had a chance to land.
      await toloEnqueue("tolo:alert-scan", { shopDomain }, { delayMs: 120_000 });
    }
  },
  "tolo:alert-scan": (p) => toloScanAlerts(p.shopDomain),
  "tolo:reconcile": (p) => toloReconcileShop(p.shopDomain),
  "tolo:reconcile-all": async () => {
    for (const shopDomain of await toloActiveShopDomains()) {
      await toloEnqueue("tolo:reconcile", { shopDomain });
    }
  },
  "tolo:weekly-email-all": () => toloSendWeeklyEmails(),
  "tolo:weekly-email": () => toloSendWeeklyEmails(),
  "tolo:shop-purge": (p) => toloPurgeShop(p.shopDomain),
  "tolo:gdpr-customer-redact": (p) =>
    toloGdprCustomerRedact(p.shopDomain, p.payload),
};

/** Single dispatch point used by both the BullMQ worker and inline dev mode. */
export async function toloRunJob<N extends ToloJobName>(
  name: N,
  payload: ToloJobPayloads[N],
): Promise<void> {
  const handler = toloJobHandlers[name];
  if (!handler) {
    throw new Error(`Unknown tolo job: ${name}`);
  }
  await handler(payload);
}
