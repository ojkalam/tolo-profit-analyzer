import type { Queue as QueueClass, Worker as WorkerClass } from "bullmq";
import { TOLO_QUEUE_NAME, type ToloJobName } from "./tolo-queue.server";
import { toloRunJob } from "./tolo-job-handlers.server";
import { toloCaptureException } from "../services/tolo-sentry.server";

export async function toloStartWorker(
  Worker: typeof WorkerClass,
  Queue: typeof QueueClass,
): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error(
      "[tolo-worker] REDIS_URL is not set. In dev, jobs run inline in the web process; the worker is only needed with Redis.",
    );
    process.exit(1);
  }

  const connection = { url: redisUrl };

  // Repeatable schedules (CLAUDE.md §4.4): nightly rollup at 02:00 UTC,
  // reconciliation at 03:30, weekly email sweep hourly on Mondays (the
  // handler picks shops at 08:00 local time).
  const queue = new Queue(TOLO_QUEUE_NAME, { connection });
  await queue.upsertJobScheduler(
    "tolo:rollup-all",
    { pattern: "0 2 * * *" },
    { name: "tolo:rollup-all", data: {} },
  );
  await queue.upsertJobScheduler(
    "tolo:reconcile-all",
    { pattern: "30 3 * * *" },
    { name: "tolo:reconcile-all", data: {} },
  );
  await queue.upsertJobScheduler(
    "tolo:weekly-email-all",
    { pattern: "0 * * * 1" },
    { name: "tolo:weekly-email-all", data: {} },
  );

  const worker = new Worker(
    TOLO_QUEUE_NAME,
    async (job) => {
      await toloRunJob(job.name as ToloJobName, job.data);
    },
    { connection, concurrency: 5 },
  );

  worker.on("failed", (job, error) => {
    toloCaptureException(error, { job: job?.name, payload: job?.data });
  });

  console.log(`[tolo-worker] listening on queue "${TOLO_QUEUE_NAME}"`);

  const shutdown = async () => {
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
