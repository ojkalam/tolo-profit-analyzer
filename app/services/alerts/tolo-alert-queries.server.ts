import prisma from "../../db.server";
import { toloGetOrCreateAlertRule } from "./tolo-alerts.server";
export { toloAlertHeadline } from "./tolo-alert-format";

export interface ToloAlertView {
  id: string;
  productId: string | null;
  productTitle: string;
  date: string;
  kind: string;
  detail: Record<string, unknown>;
  status: string;
  createdAt: string;
}

export async function toloListAlerts(
  shopId: string,
  status?: "new" | "seen" | "resolved",
): Promise<ToloAlertView[]> {
  const alerts = await prisma.toloAlert.findMany({
    where: { shopId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const productIds = [
    ...new Set(alerts.map((a) => a.productId).filter((id): id is string => !!id)),
  ];
  const titles = await prisma.toloVariant.findMany({
    where: { shopId, productId: { in: productIds } },
    select: { productId: true, productTitle: true },
  });
  const titleFor = new Map(titles.map((t) => [t.productId, t.productTitle]));
  return alerts.map((a) => ({
    id: a.id,
    productId: a.productId,
    productTitle: a.productId
      ? (titleFor.get(a.productId) ?? "A product")
      : "Store-wide",
    date: a.date,
    kind: a.kind,
    detail: a.detail as Record<string, unknown>,
    status: a.status,
    createdAt: a.createdAt.toISOString().slice(0, 10),
  }));
}

export async function toloSetAlertStatus(
  shopId: string,
  id: string,
  status: "new" | "seen" | "resolved",
): Promise<void> {
  await prisma.toloAlert.updateMany({
    where: { id, shopId },
    data: { status },
  });
}

export interface ToloAlertRuleView {
  marginFloorBps: number;
  channelInApp: boolean;
  channelEmail: boolean;
  active: boolean;
}

export async function toloGetAlertRuleView(
  shopId: string,
): Promise<ToloAlertRuleView> {
  const rule = await toloGetOrCreateAlertRule(shopId);
  const channels = rule.channels as { inApp?: boolean; email?: boolean };
  return {
    marginFloorBps: rule.marginFloorBps,
    channelInApp: channels.inApp ?? true,
    channelEmail: channels.email ?? false,
    active: rule.active,
  };
}

export async function toloUpdateAlertRule(
  shopId: string,
  input: {
    marginFloorBps: number;
    channelInApp: boolean;
    channelEmail: boolean;
    active: boolean;
  },
): Promise<void> {
  await toloGetOrCreateAlertRule(shopId);
  await prisma.toloAlertRule.update({
    where: { shopId },
    data: {
      marginFloorBps: Math.max(0, Math.min(10_000, input.marginFloorBps)),
      channels: { inApp: input.channelInApp, email: input.channelEmail },
      active: input.active,
    },
  });
}

