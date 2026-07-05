import prisma from "../../db.server";
import { toloDecimalToCents } from "../profit/tolo-money";
import { toloGraphql } from "../tolo-graphql.server";
import { toloAdminForShop, toloEnsureShop } from "../tolo-shops.server";

const TOLO_VARIANT_FIELDS = `#graphql
  fragment ToloVariantFields on ProductVariant {
    id
    title
    sku
    price
    inventoryItem {
      id
      unitCost {
        amount
      }
      measurement {
        weight {
          unit
          value
        }
      }
    }
  }
`;

const TOLO_CATALOG_SYNC_QUERY = `#graphql
  query ToloCatalogSync($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        variants(first: 100) {
          nodes {
            ...ToloVariantFields
          }
        }
      }
    }
  }
  ${TOLO_VARIANT_FIELDS}
`;

const TOLO_PRODUCT_SYNC_QUERY = `#graphql
  query ToloProductSync($id: ID!) {
    product(id: $id) {
      id
      title
      status
      variants(first: 100) {
        nodes {
          ...ToloVariantFields
        }
      }
    }
  }
  ${TOLO_VARIANT_FIELDS}
`;

interface ToloRawVariant {
  id: string;
  title?: string | null;
  sku?: string | null;
  price?: string | null;
  inventoryItem?: {
    id: string;
    unitCost?: { amount?: string | null } | null;
    measurement?: {
      weight?: { unit?: string | null; value?: number | null } | null;
    } | null;
  } | null;
}

interface ToloRawProduct {
  id: string;
  title: string;
  status?: string | null;
  variants?: { nodes?: ToloRawVariant[] | null } | null;
}

function toloWeightToGrams(
  weight: { unit?: string | null; value?: number | null } | null | undefined,
): number {
  const value = weight?.value ?? 0;
  switch (weight?.unit) {
    case "KILOGRAMS":
      return Math.round(value * 1000);
    case "OUNCES":
      return Math.round(value * 28.3495);
    case "POUNDS":
      return Math.round(value * 453.592);
    case "GRAMS":
    default:
      return Math.round(value);
  }
}

async function toloUpsertProduct(
  shopId: string,
  product: ToloRawProduct,
): Promise<void> {
  for (const variant of product.variants?.nodes ?? []) {
    const weightGrams = toloWeightToGrams(
      variant.inventoryItem?.measurement?.weight,
    );
    const data = {
      shopId,
      variantId: variant.id,
      productId: product.id,
      productTitle: product.title,
      variantTitle: variant.title ?? null,
      sku: variant.sku ?? null,
      priceCents: toloDecimalToCents(variant.price ?? null),
      weightGrams,
      inventoryItemId: variant.inventoryItem?.id ?? null,
      productStatus: product.status ?? "ACTIVE",
    };
    await prisma.toloVariant.upsert({
      where: { shopId_variantId: { shopId, variantId: variant.id } },
      create: data,
      update: data,
    });

    // Seed/refresh imported COGS from Shopify's unitCost — never over a
    // manual cost (CLAUDE.md 1.3).
    const unitCostCents = toloDecimalToCents(
      variant.inventoryItem?.unitCost?.amount ?? null,
    );
    if (unitCostCents <= 0) continue;

    const latest = await prisma.toloProductCost.findFirst({
      where: { shopId, variantId: variant.id },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!latest) {
      // First import: apply from the beginning of time so historical orders
      // resolve a cost — the merchant's current cost is the best estimate.
      await prisma.toloProductCost.create({
        data: {
          shopId,
          variantId: variant.id,
          productId: product.id,
          costCents: unitCostCents,
          effectiveFrom: new Date(0),
          source: "shopify_import",
        },
      });
    } else if (
      latest.source === "shopify_import" &&
      latest.costCents !== unitCostCents
    ) {
      await prisma.toloProductCost.create({
        data: {
          shopId,
          variantId: variant.id,
          productId: product.id,
          costCents: unitCostCents,
          effectiveFrom: new Date(),
          source: "shopify_import",
        },
      });
    }
    // latest.source === "manual" → leave the merchant's number alone.
  }
}

/** Job handler: full catalog sweep, or a single product (webhook path). */
export async function toloSyncCatalog(
  shopDomain: string,
  productId?: string,
): Promise<void> {
  const graphql = await toloAdminForShop(shopDomain);
  const shop = await toloEnsureShop(shopDomain);

  if (productId) {
    const data = await toloGraphql<{ product: ToloRawProduct | null }>(
      graphql,
      TOLO_PRODUCT_SYNC_QUERY,
      { id: productId },
    );
    if (data.product) {
      await toloUpsertProduct(shop.id, data.product);
    }
    return;
  }

  let cursor: string | null = null;
  for (;;) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ToloRawProduct[];
      };
    } = await toloGraphql(graphql, TOLO_CATALOG_SYNC_QUERY, {
      cursor,
    });
    for (const product of data.products.nodes) {
      await toloUpsertProduct(shop.id, product);
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  await prisma.toloShop.update({
    where: { id: shop.id },
    data: { catalogSyncedAt: new Date() },
  });
}
