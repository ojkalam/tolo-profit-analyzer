import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV ?? "development",
  });
}

/**
 * Central error reporter. Always logs; forwards to Sentry when SENTRY_DSN is
 * configured. Use this in job handlers and catch blocks instead of bare
 * console.error so production errors are never silent.
 */
export function toloCaptureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  console.error("[tolo]", error, context ?? "");
  if (dsn) {
    Sentry.captureException(error, { extra: context });
  }
}
