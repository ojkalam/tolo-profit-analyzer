import prisma from "../../db.server";
import { toloDayKey } from "../tolo-dates";
import type { ToloShop } from "@prisma/client";

export interface ToloPlanDef {
  key: "basic" | "growth" | "pro";
  billingName: string; // must match the shopifyApp billing config key
  priceUsd: number;
  monthlyOrderLimit: number | null;
  features: string[];
}

export const TOLO_PLANS: ToloPlanDef[] = [
  {
    key: "basic",
    billingName: "Tolo Basic",
    priceUsd: 9,
    monthlyOrderLimit: 100,
    features: ["Profit dashboard", "Best/worst products"],
  },
  {
    key: "growth",
    billingName: "Tolo Growth",
    priceUsd: 29,
    monthlyOrderLimit: 1000,
    features: [
      "Everything in Basic",
      "Margin alerts",
      "Discount & returns impact",
      "Weekly profit email",
    ],
  },
  {
    key: "pro",
    billingName: "Tolo Pro",
    priceUsd: 79,
    monthlyOrderLimit: null,
    features: [
      "Everything in Growth",
      "Unlimited orders",
      "True ROAS",
      "CSV export",
      "24-month history",
    ],
  },
];

export function toloPlanByBillingName(name: string): ToloPlanDef | undefined {
  return TOLO_PLANS.find((plan) => plan.billingName === name);
}

export function toloPlanByKey(key: string): ToloPlanDef | undefined {
  return TOLO_PLANS.find((plan) => plan.key === key);
}

/** Feature gates. Trials see everything — the trial sells the upgrade. */
export function toloCanUseAlerts(plan: string): boolean {
  return plan === "trial" || plan === "growth" || plan === "pro";
}

export function toloCanUseImpactViews(plan: string): boolean {
  return plan === "trial" || plan === "growth" || plan === "pro";
}

export function toloCanExportCsv(plan: string): boolean {
  return plan === "trial" || plan === "pro";
}

export interface ToloOrderUsage {
  used: number;
  limit: number | null;
  over: boolean;
}

/**
 * Calendar-month order count vs the plan cap. Ingestion never stops (no
 * silent data loss) — the dashboard surfaces the upgrade prompt when over.
 */
export async function toloOrderUsage(shop: ToloShop): Promise<ToloOrderUsage> {
  const plan = toloPlanByKey(shop.plan);
  const limit = shop.plan === "trial" ? null : (plan?.monthlyOrderLimit ?? null);
  const today = toloDayKey(new Date(), shop.ianaTimezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const used = await prisma.toloOrderRecord.count({
    where: { shopId: shop.id, day: { gte: monthStart }, test: false },
  });
  return { used, limit, over: limit != null && used > limit };
}

/** Map an app_subscriptions/update payload onto the ToloShop.plan field. */
export async function toloSyncPlanFromSubscription(
  shopDomain: string,
  subscription: { name?: string; status?: string } | null | undefined,
): Promise<void> {
  if (!subscription?.name || !subscription.status) return;
  const plan = toloPlanByBillingName(subscription.name);
  if (!plan) return;
  const active = subscription.status === "ACTIVE";
  await prisma.toloShop.updateMany({
    where: { shopDomain },
    data: { plan: active ? plan.key : "trial" },
  });
}
