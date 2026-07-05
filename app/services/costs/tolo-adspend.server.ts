import prisma from "../../db.server";
import { toloEnqueue } from "../../jobs/tolo-queue.server";
import {
  toloApportionCents,
} from "../profit/tolo-money";
import { toloDaysInMonth, toloEnumerateDays } from "../tolo-dates";

export type ToloAdChannel = "meta" | "google" | "tiktok" | "other";
export const TOLO_AD_CHANNELS: ToloAdChannel[] = [
  "meta",
  "google",
  "tiktok",
  "other",
];

export interface ToloAdSpendRow {
  id: string;
  channel: string;
  date: string;
  amountCents: number;
  note: string | null;
}

export async function toloListAdSpend(
  shopId: string,
  limit = 200,
): Promise<ToloAdSpendRow[]> {
  const rows = await prisma.toloAdSpendEntry.findMany({
    where: { shopId },
    orderBy: { date: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    date: row.date,
    amountCents: row.amountCents,
    note: row.note,
  }));
}

export interface ToloAdSpendInput {
  channel: ToloAdChannel;
  /** Single day, or a range (auto-split evenly, largest-remainder). */
  date: string;
  endDate?: string;
  amountCents: number;
  note?: string;
}

/**
 * Record ad spend. A range or month total is split across its days with no
 * lost cents, so daily allocation stays exact.
 */
export async function toloAddAdSpend(
  shopDomain: string,
  shopId: string,
  input: ToloAdSpendInput,
): Promise<void> {
  const days =
    input.endDate && input.endDate > input.date
      ? toloEnumerateDays(input.date, input.endDate)
      : [input.date];
  const split = toloApportionCents(
    input.amountCents,
    days.map(() => 1),
  );

  await prisma.toloAdSpendEntry.createMany({
    data: days.map((day, i) => ({
      shopId,
      channel: input.channel,
      date: day,
      amountCents: split[i],
      note: input.note ?? null,
    })),
  });

  await toloEnqueueAdSpendRecompute(shopDomain, days[0]);
}

/** Convenience: split a whole-month total across the month's days. */
export async function toloAddMonthlyAdSpend(
  shopDomain: string,
  shopId: string,
  channel: ToloAdChannel,
  monthKey: string,
  amountCents: number,
  note?: string,
): Promise<void> {
  const days = toloDaysInMonth(monthKey);
  await toloAddAdSpend(shopDomain, shopId, {
    channel,
    date: `${monthKey}-01`,
    endDate: `${monthKey}-${String(days).padStart(2, "0")}`,
    amountCents,
    note,
  });
}

export async function toloDeleteAdSpend(
  shopDomain: string,
  id: string,
): Promise<void> {
  const row = await prisma.toloAdSpendEntry.findUnique({ where: { id } });
  await prisma.toloAdSpendEntry.delete({ where: { id } });
  if (row) await toloEnqueueAdSpendRecompute(shopDomain, row.date);
}

async function toloEnqueueAdSpendRecompute(
  shopDomain: string,
  from: string,
): Promise<void> {
  await toloEnqueue(
    "tolo:rollup",
    { shopDomain, from },
    { dedupeId: `tolo:rollup:${shopDomain}:adspend`, delayMs: 4_000 },
  );
}
