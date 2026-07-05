import type { ToloAdminGraphql } from "./tolo-shops.server";

export class ToloGraphqlError extends Error {
  constructor(
    message: string,
    readonly errors: unknown,
  ) {
    super(message);
    this.name = "ToloGraphqlError";
  }
}

interface ToloGraphqlErrorShape {
  message?: string;
  extensions?: { code?: string };
}

interface ToloGraphqlBody<T> {
  data?: T;
  errors?: ToloGraphqlErrorShape[];
  extensions?: {
    cost?: {
      throttleStatus?: { restoreRate?: number; currentlyAvailable?: number };
    };
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Single Admin API call path for all services: parses the body, retries
 * THROTTLED responses with backoff informed by the cost extension, and
 * throws ToloGraphqlError on anything else.
 */
export async function toloGraphql<T>(
  graphql: ToloAdminGraphql,
  query: string,
  variables?: Record<string, unknown>,
  maxRetries = 4,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    const response = await graphql(query, variables ? { variables } : undefined);
    const body = (await response.json()) as ToloGraphqlBody<T>;

    if (!body.errors || body.errors.length === 0) {
      if (body.data == null) {
        throw new ToloGraphqlError("GraphQL response had no data", body);
      }
      return body.data;
    }

    const throttled = body.errors.some(
      (e) => e.extensions?.code === "THROTTLED",
    );
    if (throttled && attempt < maxRetries) {
      attempt += 1;
      const restoreRate =
        body.extensions?.cost?.throttleStatus?.restoreRate ?? 50;
      // Wait long enough to restore a typical query cost, with backoff.
      const waitMs = Math.min(10_000, (1_000 * attempt * 100) / restoreRate);
      await sleep(waitMs);
      continue;
    }

    throw new ToloGraphqlError(
      body.errors.map((e) => e.message).join("; ") || "GraphQL error",
      body.errors,
    );
  }
}
