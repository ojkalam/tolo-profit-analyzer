import type { ToloShop } from "@prisma/client";
import prisma from "../../db.server";
import {
  toloAddDays,
  toloDayKey,
  toloLocalHour,
  toloLocalIsoWeekday,
  toloWeekKey,
} from "../tolo-dates";
import { toloFormatBps, toloFormatCents } from "../profit/tolo-money";
import { toloSendEmail } from "./tolo-email.server";
import { toloCaptureException } from "../tolo-sentry.server";

// Weekly email is a Growth/Pro feature (CLAUDE.md §3); trials get it too so
// they hit the aha moment before paying.
const TOLO_WEEKLY_PLANS = new Set(["trial", "growth", "pro"]);

export interface ToloWeeklyPayload {
  weekKey: string;
  from: string;
  to: string;
  netProfitCents: number;
  netRevenueCents: number;
  marginBps: number;
  winners: Array<{ title: string; netProfitCents: number }>;
  losers: Array<{ title: string; netProfitCents: number }>;
  action: string;
}

/** Build the Monday summary for the last full Mon–Sun week. */
export async function toloBuildWeeklyPayload(
  shop: ToloShop,
): Promise<ToloWeeklyPayload | null> {
  const today = toloDayKey(new Date(), shop.ianaTimezone);
  const weekday = toloLocalIsoWeekday(new Date(), shop.ianaTimezone);
  // Last full week: the Monday..Sunday block ending before today.
  const lastSunday = toloAddDays(today, -weekday);
  const lastMonday = toloAddDays(lastSunday, -6);

  const days = await prisma.toloDailyProfit.findMany({
    where: { shopId: shop.id, date: { gte: lastMonday, lte: lastSunday } },
  });
  if (days.length === 0) return null;

  const netProfitCents = days.reduce((sum, d) => sum + d.netProfitCents, 0);
  const netRevenueCents = days.reduce((sum, d) => sum + d.netRevenueCents, 0);
  const marginBps =
    netRevenueCents > 0
      ? Math.round((netProfitCents * 10_000) / netRevenueCents)
      : 0;

  const productRows = await prisma.toloProductDailyProfit.groupBy({
    by: ["productId"],
    where: { shopId: shop.id, date: { gte: lastMonday, lte: lastSunday } },
    _sum: { netProfitCents: true },
  });
  const ranked = productRows
    .map((row) => ({
      productId: row.productId,
      netProfitCents: row._sum.netProfitCents ?? 0,
    }))
    .sort((a, b) => b.netProfitCents - a.netProfitCents);

  const titles = await prisma.toloVariant.findMany({
    where: {
      shopId: shop.id,
      productId: { in: ranked.map((r) => r.productId) },
    },
    select: { productId: true, productTitle: true },
  });
  const titleFor = new Map(titles.map((t) => [t.productId, t.productTitle]));
  const named = (rows: typeof ranked) =>
    rows.map((row) => ({
      title: titleFor.get(row.productId) ?? "Unattributed",
      netProfitCents: row.netProfitCents,
    }));

  const winners = named(ranked.filter((r) => r.netProfitCents > 0).slice(0, 3));
  const losers = named(
    ranked
      .filter((r) => r.netProfitCents < 0)
      .sort((a, b) => a.netProfitCents - b.netProfitCents)
      .slice(0, 3),
  );

  const missing = days.reduce((sum, d) => sum + d.cogsMissingCents, 0);
  let action: string;
  if (missing > netRevenueCents * 0.1) {
    action =
      "Set product costs for your remaining catalog — a chunk of last week's revenue has unknown margins.";
  } else if (losers.length > 0) {
    action = `Review pricing or discounting on “${losers[0].title}” — it lost money last week.`;
  } else if (winners.length > 0) {
    action = `“${winners[0].title}” is your profit engine — consider putting more ad budget behind it.`;
  } else {
    action = "Add this week's ad spend so margins stay accurate.";
  }

  return {
    weekKey: toloWeekKey(lastMonday),
    from: lastMonday,
    to: lastSunday,
    netProfitCents,
    netRevenueCents,
    marginBps,
    winners,
    losers,
    action,
  };
}

function toloWeeklyHtml(shop: ToloShop, payload: ToloWeeklyPayload): string {
  const money = (cents: number) => toloFormatCents(cents, shop.currency);
  const list = (
    rows: Array<{ title: string; netProfitCents: number }>,
    empty: string,
  ) =>
    rows.length === 0
      ? `<li>${empty}</li>`
      : rows
          .map((r) => `<li>${r.title}: <strong>${money(r.netProfitCents)}</strong></li>`)
          .join("");
  return `
    <h2>Your week in profit (${payload.from} → ${payload.to})</h2>
    <p style="font-size:20px">Net profit: <strong>${money(payload.netProfitCents)}</strong>
      (margin ${toloFormatBps(payload.marginBps)} on ${money(payload.netRevenueCents)} net revenue)</p>
    <h3>Top winners</h3><ul>${list(payload.winners, "No profitable products last week")}</ul>
    <h3>Top losers</h3><ul>${list(payload.losers, "Nothing lost money — nice")}</ul>
    <h3>One thing to do this week</h3><p>${payload.action}</p>
    <p>— Tolo Profit Analyzer</p>`;
}

async function toloAlreadySent(
  shopDomain: string,
  weekKey: string,
): Promise<boolean> {
  const row = await prisma.toloAuditLog.findFirst({
    where: {
      shopDomain,
      action: "weekly_email_sent",
      detail: { equals: { weekKey } },
    },
  });
  return row != null;
}

/** Job handler (fan-out): hourly on Mondays; sends at 08:00 shop-local. */
export async function toloSendWeeklyEmails(): Promise<void> {
  const now = new Date();
  const shops = await prisma.toloShop.findMany({
    where: { uninstalledAt: null, weeklyEmail: true },
  });
  for (const shop of shops) {
    try {
      if (!TOLO_WEEKLY_PLANS.has(shop.plan)) continue;
      if (!shop.notificationEmail) continue;
      if (toloLocalIsoWeekday(now, shop.ianaTimezone) !== 1) continue;
      if (toloLocalHour(now, shop.ianaTimezone) !== 8) continue;

      const payload = await toloBuildWeeklyPayload(shop);
      if (!payload) continue;
      if (await toloAlreadySent(shop.shopDomain, payload.weekKey)) continue;

      await toloSendEmail({
        to: shop.notificationEmail,
        subject: `Last week's profit: ${toloFormatCents(payload.netProfitCents, shop.currency)}`,
        html: toloWeeklyHtml(shop, payload),
      });
      await prisma.toloAuditLog.create({
        data: {
          shopDomain: shop.shopDomain,
          action: "weekly_email_sent",
          detail: { weekKey: payload.weekKey },
        },
      });
    } catch (error) {
      toloCaptureException(error, { shopDomain: shop.shopDomain });
    }
  }
}
