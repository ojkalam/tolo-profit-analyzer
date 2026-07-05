import { Queue } from "bullmq";
import { toloCaptureException } from "../services/tolo-sentry.server";

// ---------------------------------------------------------------------------
// Job catalog. Webhook handlers and routes enqueue; handlers live in
// tolo-job-handlers.server.ts and run in the worker process (BullMQ) or, when
// REDIS_URL is unset (local dev), inline in this process off the request path.
// ---------------------------------------------------------------------------

export interface ToloJobPayloads {
  /** Fetch one order (incl. refunds) from the Admin API and upsert it. */
  "tolo:order-sync": { shopDomain: string; orderId: string };
  /** Full or single-product catalog + unitCost import. */
  "tolo:catalog-sync": { shopDomain: string; productId?: string };
  /** Kick off a Bulk Operations historical order import. */
  "tolo:bulk-import": { shopDomain: string; months?: number };
  /** Poll a running bulk operation; processes the JSONL when complete. */
  "tolo:bulk-import-poll": { shopDomain: string };
  /** Recompute DailyProfit/ProductDailyProfit rollups for a day range. */
  "tolo:rollup": { shopDomain: string; from?: string; to?: string };
  /** Fan-out: nightly rollup for every active shop. */
  "tolo:rollup-all": Record<string, never>;
  /** Margin/negative/returns detectors for one shop (runs after rollup). */
  "tolo:alert-scan": { shopDomain: string };
  /** Nightly webhook-gap reconciliation for one shop / all shops. */
  "tolo:reconcile": { shopDomain: string };
  "tolo:reconcile-all": Record<string, never>;
  /** Weekly profit email fan-out (hourly on Mondays, shop-local 08:00). */
  "tolo:weekly-email-all": Record<string, never>;
  "tolo:weekly-email": { shopDomain: string };
  /** GDPR: hard-delete everything for a shop. */
  "tolo:shop-purge": { shopDomain: string };
  /** GDPR customer redact — we store no customer PII; logs + audits. */
  "tolo:gdpr-customer-redact": { shopDomain: string; payload: unknown };
}

export type ToloJobName = keyof ToloJobPayloads;

export const TOLO_QUEUE_NAME = "tolo-jobs";

const redisUrl = process.env.REDIS_URL;

let toloQueue: Queue | null = null;

function getToloQueue(): Queue | null {
  if (!redisUrl) return null;
  if (!toloQueue) {
    toloQueue = new Queue(TOLO_QUEUE_NAME, {
      connection: { url: redisUrl },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
  }
  return toloQueue;
}

// Inline-mode debounce timers, keyed by dedupeId.
const toloInlineTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface ToloEnqueueOptions {
  /** Delay before the job may run. */
  delayMs?: number;
  /**
   * Debounce/dedupe key: enqueues sharing this key within the dedupe window
   * collapse into one run. In BullMQ this maps to a time-bucketed jobId —
   * bucketing matters because BullMQ also rejects ids that match *completed*
   * jobs still in the retention set, which would otherwise block all future
   * runs with the same key.
   */
  dedupeId?: string;
  /** Dedupe window size (default 60s). */
  dedupeWindowMs?: number;
}

/**
 * Enqueue a job. Never throws into the caller's request path — webhook
 * handlers must be able to return 200 unconditionally.
 */
export async function toloEnqueue<N extends ToloJobName>(
  name: N,
  payload: ToloJobPayloads[N],
  opts: ToloEnqueueOptions = {},
): Promise<void> {
  const queue = getToloQueue();
  if (queue) {
    try {
      const window = opts.dedupeWindowMs ?? 60_000;
      const bucketedId = opts.dedupeId
        ? `${opts.dedupeId}:${Math.floor(Date.now() / window)}`
        : undefined;
      await queue.add(name, payload, {
        delay: opts.delayMs,
        ...(bucketedId ? { jobId: bucketedId } : {}),
      });
    } catch (error) {
      toloCaptureException(error, { job: name, payload });
    }
    return;
  }

  // Local dev fallback: run inline, off the request path.
  const run = () => {
    void (async () => {
      try {
        const { toloRunJob } = await import("./tolo-job-handlers.server");
        await toloRunJob(name, payload);
      } catch (error) {
        toloCaptureException(error, { job: name, payload });
      }
    })();
  };

  if (opts.dedupeId) {
    const existing = toloInlineTimers.get(opts.dedupeId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      toloInlineTimers.delete(opts.dedupeId!);
      run();
    }, opts.delayMs ?? 25);
    toloInlineTimers.set(opts.dedupeId, timer);
  } else {
    setTimeout(run, opts.delayMs ?? 25);
  }
}
