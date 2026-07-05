import type { ToloAlertRule, ToloShop } from "@prisma/client";
import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { toloAddDays, toloDayKey, toloWeekKey } from "../tolo-dates";
import { toloGetShop } from "../tolo-shops.server";
import { toloFormatBps, toloFormatCents } from "../profit/tolo-money";
import { toloDetectMarginAnomaly } from "../profit/tolo-profit-engine";
import { toloSendEmail } from "../reports/tolo-email.server";
import { toloCaptureException } from "../tolo-sentry.server";

export interface ToloAlertChannels {
  inApp: boolean;
  email: boolean;
}

export async function toloGetOrCreateAlertRule(
  shopId: string,
): Promise<ToloAlertRule> {
  const existing = await prisma.toloAlertRule.findUnique({
    where: { shopId },
  });
  if (existing) return existing;
  return prisma.toloAlertRule.create({
    data: {
      shopId,
      marginFloorBps: 2500,
      channels: { inApp: true, email: false },
      active: true,
    },
  });
}

interface ToloProductWindow {
  productId: string;
  gross: number;
  discount: number;
  refund: number;
  cogs: number;
  netRevenue: number;
  netProfit: number;
  marginBps: number;
}

function summarizeWindow(
  rows: Array<{
    productId: string;
    grossCents: number;
    discountCents: number;
    refundCents: number;
    cogsCents: number;
    netRevenueCents: number;
    netProfitCents: number;
  }>,
): Map<string, ToloProductWindow> {
  const byProduct = new Map<string, ToloProductWindow>();
  for (const row of rows) {
    let entry = byProduct.get(row.productId);
    if (!entry) {
      entry = {
        productId: row.productId,
        gross: 0,
        discount: 0,
        refund: 0,
        cogs: 0,
        netRevenue: 0,
        netProfit: 0,
        marginBps: 0,
      };
      byProduct.set(row.productId, entry);
    }
    entry.gross += row.grossCents;
    entry.discount += row.discountCents;
    entry.refund += row.refundCents;
    entry.cogs += row.cogsCents;
    entry.netRevenue += row.netRevenueCents;
    entry.netProfit += row.netProfitCents;
  }
  for (const entry of byProduct.values()) {
    entry.marginBps =
      entry.netRevenue > 0
        ? Math.round((entry.netProfit * 10_000) / entry.netRevenue)
        : 0;
  }
  return byProduct;
}

/**
 * Why did the margin slip? Compare cost/discount/refund shares of gross
 * against the prior window and name the biggest mover.
 */
function toloAlertReason(
  current: ToloProductWindow,
  prior: ToloProductWindow | undefined,
): string {
  if (!prior || prior.gross <= 0 || current.gross <= 0) {
    return "margin below floor";
  }
  const deltas: Array<[string, number]> = [
    [
      "product cost rose",
      current.cogs / current.gross - prior.cogs / prior.gross,
    ],
    [
      "heavier discounting",
      current.discount / current.gross - prior.discount / prior.gross,
    ],
    [
      "returns spiked",
      current.refund / current.gross - prior.refund / prior.gross,
    ],
  ];
  deltas.sort((a, b) => b[1] - a[1]);
  const [reason, delta] = deltas[0];
  return delta > 0.005 ? reason : "margin below floor";
}

async function toloCreateAlert(data: {
  shopId: string;
  productId: string | null;
  date: string;
  kind: string;
  detail: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await prisma.toloAlert.create({
      data: {
        ...data,
        weekKey: toloWeekKey(data.date),
        detail: data.detail as Prisma.InputJsonValue,
      },
    });
    return true;
  } catch (error) {
    // Unique violation = already alerted this product/kind this week.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Daily detector pass (runs after rollup): margin_drop / negative /
 * returns_spike over a trailing 7-day window vs the 7 days before it.
 */
export async function toloScanAlerts(shopDomain: string): Promise<void> {
  const shop = await toloGetShop(shopDomain);
  const rule = await toloGetOrCreateAlertRule(shop.id);
  if (!rule.active) return;

  const today = toloDayKey(new Date(), shop.ianaTimezone);
  const yesterday = toloAddDays(today, -1);
  const currentFrom = toloAddDays(today, -7);
  const priorFrom = toloAddDays(today, -14);

  const rows = await prisma.toloProductDailyProfit.findMany({
    where: { shopId: shop.id, date: { gte: priorFrom, lt: today } },
  });
  const current = summarizeWindow(rows.filter((r) => r.date >= currentFrom));
  const prior = summarizeWindow(rows.filter((r) => r.date < currentFrom));

  const created: Array<{ kind: string; productId: string; detail: string }> =
    [];

  for (const [productId, window] of current) {
    if (window.netRevenue <= 0) continue;

    if (window.netProfit < 0) {
      const fresh = await toloCreateAlert({
        shopId: shop.id,
        productId,
        date: yesterday,
        kind: "negative",
        detail: {
          marginBps: window.marginBps,
          netProfitCents: window.netProfit,
          netRevenueCents: window.netRevenue,
          reason: toloAlertReason(window, prior.get(productId)),
        },
      });
      if (fresh) {
        created.push({
          kind: "negative",
          productId,
          detail: `losing ${toloFormatCents(-window.netProfit, shop.currency)} over 7 days`,
        });
      }
      continue; // negative supersedes margin_drop
    }

    if (window.marginBps < rule.marginFloorBps) {
      const reason = toloAlertReason(window, prior.get(productId));
      const fresh = await toloCreateAlert({
        shopId: shop.id,
        productId,
        date: yesterday,
        kind: "margin_drop",
        detail: {
          marginBps: window.marginBps,
          floorBps: rule.marginFloorBps,
          reason,
        },
      });
      if (fresh) {
        created.push({
          kind: "margin_drop",
          productId,
          detail: `margin ${toloFormatBps(window.marginBps)} < floor ${toloFormatBps(rule.marginFloorBps)} (${reason})`,
        });
      }
    }

    const priorWindow = prior.get(productId);
    const refundRate = window.gross > 0 ? window.refund / window.gross : 0;
    const priorRate =
      priorWindow && priorWindow.gross > 0
        ? priorWindow.refund / priorWindow.gross
        : 0;
    if (refundRate > 0.1 && refundRate > priorRate * 2) {
      const fresh = await toloCreateAlert({
        shopId: shop.id,
        productId,
        date: yesterday,
        kind: "returns_spike",
        detail: {
          refundRatePct: Math.round(refundRate * 100),
          priorRefundRatePct: Math.round(priorRate * 100),
          refundCents: window.refund,
        },
      });
      if (fresh) {
        created.push({
          kind: "returns_spike",
          productId,
          detail: `${Math.round(refundRate * 100)}% of revenue refunded (was ${Math.round(priorRate * 100)}%)`,
        });
      }
    }
  }

  // Store-wide margin anomaly (CLAUDE.md 6.4) — fires without a configured
  // threshold when the latest day's margin diverges sharply from its baseline.
  const dailyRows = await prisma.toloDailyProfit.findMany({
    where: { shopId: shop.id, date: { gte: toloAddDays(today, -14), lt: today } },
    orderBy: { date: "asc" },
    select: { date: true, marginBps: true, netRevenueCents: true },
  });
  const series = dailyRows
    .filter((r) => r.netRevenueCents > 0)
    .map((r) => r.marginBps);
  const anomaly = toloDetectMarginAnomaly(series);
  if (anomaly.isAnomaly && anomaly.latestBps < anomaly.meanBps) {
    // Store-wide alerts carry a null productId, which the unique index can't
    // dedupe (SQL treats nulls as distinct), so check the week manually.
    const already = await prisma.toloAlert.findFirst({
      where: {
        shopId: shop.id,
        productId: null,
        kind: "anomaly",
        weekKey: toloWeekKey(yesterday),
      },
    });
    if (!already) {
      await prisma.toloAlert.create({
        data: {
          shopId: shop.id,
          productId: null,
          date: yesterday,
          weekKey: toloWeekKey(yesterday),
          kind: "anomaly",
          detail: {
            latestBps: anomaly.latestBps,
            meanBps: Math.round(anomaly.meanBps),
            zScore: Number.isFinite(anomaly.zScore)
              ? Math.round(anomaly.zScore * 10) / 10
              : null,
          } as Prisma.InputJsonValue,
        },
      });
      created.push({
        kind: "anomaly",
        productId: "",
        detail: `store margin dropped to ${toloFormatBps(anomaly.latestBps)} (usually ${toloFormatBps(Math.round(anomaly.meanBps))})`,
      });
    }
  }

  const channels = rule.channels as unknown as ToloAlertChannels;
  if (created.length > 0 && channels.email && shop.notificationEmail) {
    await toloSendAlertEmail(shop, created);
  }
}

async function toloSendAlertEmail(
  shop: ToloShop,
  alerts: Array<{ kind: string; productId: string; detail: string }>,
): Promise<void> {
  const titles = await prisma.toloVariant.findMany({
    where: { shopId: shop.id, productId: { in: alerts.map((a) => a.productId) } },
    select: { productId: true, productTitle: true },
  });
  const titleFor = new Map(titles.map((t) => [t.productId, t.productTitle]));
  const items = alerts
    .map(
      (alert) =>
        `<li><strong>${titleFor.get(alert.productId) ?? "A product"}</strong> — ${alert.kind.replace("_", " ")}: ${alert.detail}</li>`,
    )
    .join("");
  try {
    await toloSendEmail({
      to: shop.notificationEmail!,
      subject: `Tolo margin alert: ${alerts.length} product${alerts.length > 1 ? "s" : ""} need attention`,
      html: `<p>Tolo flagged the following in the last 7 days:</p><ul>${items}</ul><p>Open the Tolo Profit Analyzer in your Shopify admin for details.</p>`,
    });
  } catch (error) {
    toloCaptureException(error, { shopDomain: shop.shopDomain });
  }
}
