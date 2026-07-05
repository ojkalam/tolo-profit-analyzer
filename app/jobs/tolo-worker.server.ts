// BullMQ worker process — `pnpm run worker`. Requires REDIS_URL; in local
// dev without Redis, jobs run inline in the web process instead and this
// process is unnecessary.
import { Worker, Queue } from "bullmq";

try {
  process.loadEnvFile?.(".env");
} catch {
  // No .env in production images — env comes from the platform.
}

import("./tolo-worker-main.server")
  .then((mod) => mod.toloStartWorker(Worker, Queue))
  .catch((error) => {
    console.error("[tolo-worker] failed to start", error);
    process.exit(1);
  });
