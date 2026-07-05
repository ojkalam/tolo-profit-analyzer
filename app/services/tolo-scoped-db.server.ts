import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

// Models that carry a shopId column. Every query against them made through
// toloShopDb() is automatically constrained to one shop, making cross-tenant
// leaks structurally impossible in list/aggregate paths.
const TOLO_SHOP_SCOPED_MODELS = new Set([
  "ToloVariant",
  "ToloProductCost",
  "ToloShippingRule",
  "ToloAdSpendEntry",
  "ToloOrderRecord",
  "ToloOrderLine",
  "ToloDailyProfit",
  "ToloProductDailyProfit",
  "ToloAlertRule",
  "ToloAlert",
]);

const WHERE_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "updateMany",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany"]);

/**
 * A Prisma client fixed to one shop. All reads/aggregates on shop-scoped
 * models get `shopId` AND-ed into their `where`; creates get `shopId`
 * injected into `data`. Unique-key operations (update/delete/upsert by id or
 * composite key) are left as-is — all our composite uniques already embed
 * shopId, and by-id rows must be fetched through this client first.
 */
export function toloShopDb(shopId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TOLO_SHOP_SCOPED_MODELS.has(model)) {
            return query(args);
          }
          const mutable = args as Record<string, unknown>;
          if (WHERE_OPERATIONS.has(operation)) {
            mutable.where = { AND: [{ shopId }, (mutable.where as object) ?? {}] };
          } else if (CREATE_OPERATIONS.has(operation)) {
            const data = mutable.data;
            if (Array.isArray(data)) {
              mutable.data = data.map((row) => ({ ...row, shopId }));
            } else if (data && typeof data === "object") {
              mutable.data = { ...data, shopId };
            }
          }
          return query(args);
        },
      },
    },
  });
}

export type ToloShopDb = ReturnType<typeof toloShopDb>;
export type { Prisma };
