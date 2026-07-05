// Local dev fixtures — the test data IS the product (CLAUDE.md 0.2). Seeds a
// shop with variants (some with, some without cost), orders across 30 days
// with discounts and a refund, ad spend, and computed rollups, so the
// dashboard shows real-looking numbers without a live Shopify sync.
//
// Run: pnpm tsx prisma/tolo-seed.ts [shop-domain]
import { PrismaClient } from "@prisma/client";
import { toloRollupRange } from "../app/services/profit/tolo-rollup.server";

const prisma = new PrismaClient();

const SHOP_DOMAIN = process.argv[2] ?? "meatworld-yhz25ler.myshopify.com";

function dayKey(offsetDaysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDaysAgo);
  return d.toISOString().slice(0, 10);
}
function at(offsetDaysAgo: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDaysAgo);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

const PRODUCTS = [
  { pid: "1001", title: "Ribeye Steak", price: 3200, cost: 1800, weight: 400 },
  { pid: "1002", title: "Brisket", price: 5400, cost: 3600, weight: 1500 },
  { pid: "1003", title: "Ground Beef 1lb", price: 1200, cost: 900, weight: 500 },
  // No cost set — exercises the missing-COGS path + completeness meter.
  { pid: "1004", title: "Beef Tallow", price: 1800, cost: null, weight: 350 },
];

async function main() {
  console.log(`Seeding ${SHOP_DOMAIN}…`);

  const shop = await prisma.toloShop.upsert({
    where: { shopDomain: SHOP_DOMAIN },
    create: {
      shopDomain: SHOP_DOMAIN,
      currency: "USD",
      ianaTimezone: "America/New_York",
      plan: "trial",
      importStatus: "complete",
      importProgress: 100,
      notificationEmail: "owner@meatworld.test",
    },
    update: { importStatus: "complete", importProgress: 100 },
  });

  // Reset prior seed data for a clean run.
  await prisma.toloOrderLine.deleteMany({ where: { shopId: shop.id } });
  await prisma.toloOrderRecord.deleteMany({ where: { shopId: shop.id } });
  await prisma.toloVariant.deleteMany({ where: { shopId: shop.id } });
  await prisma.toloProductCost.deleteMany({ where: { shopId: shop.id } });
  await prisma.toloAdSpendEntry.deleteMany({ where: { shopId: shop.id } });
  await prisma.toloDailyProfit.deleteMany({ where: { shopId: shop.id } });
  await prisma.toloProductDailyProfit.deleteMany({ where: { shopId: shop.id } });

  for (const p of PRODUCTS) {
    const variantId = `gid://shopify/ProductVariant/${p.pid}`;
    const productId = `gid://shopify/Product/${p.pid}`;
    await prisma.toloVariant.create({
      data: {
        shopId: shop.id,
        variantId,
        productId,
        productTitle: p.title,
        sku: `SKU-${p.pid}`,
        priceCents: p.price,
        weightGrams: p.weight,
        inventoryItemId: `gid://shopify/InventoryItem/${p.pid}`,
      },
    });
    if (p.cost != null) {
      await prisma.toloProductCost.create({
        data: {
          shopId: shop.id,
          variantId,
          productId,
          costCents: p.cost,
          effectiveFrom: new Date(0),
          source: "shopify_import",
        },
      });
    }
  }

  // Flat shipping rule + fees are on the shop defaults.
  await prisma.toloShippingRule.deleteMany({ where: { shopId: shop.id } });
  await prisma.toloShippingRule.create({
    data: {
      shopId: shop.id,
      kind: "flat_order",
      config: { amountCents: 600 },
      priority: 0,
      active: true,
    },
  });

  // 30 days of orders. Every 5th day carries a SUMMER20 discount; day 3 has a
  // refund on one line.
  let orderSeq = 5000;
  for (let d = 29; d >= 0; d--) {
    const ordersToday = 1 + (d % 3);
    for (let o = 0; o < ordersToday; o++) {
      const picks = PRODUCTS.filter((_, i) => (d + o + i) % 2 === 0);
      if (picks.length === 0) picks.push(PRODUCTS[0]);
      const discounted = d % 5 === 0;

      let gross = 0;
      const lines = picks.map((p) => {
        const qty = 1 + (o % 2);
        const revenue = p.price * qty;
        gross += revenue;
        return { p, qty, revenue };
      });
      const discountCents = discounted ? Math.round(gross * 0.2) : 0;
      const refundCents = d === 3 ? lines[0].revenue : 0;

      const order = await prisma.toloOrderRecord.create({
        data: {
          shopId: shop.id,
          shopifyOrderId: `gid://shopify/Order/${orderSeq++}`,
          orderNumber: `#${orderSeq}`,
          processedAt: at(d),
          day: dayKey(d),
          grossCents: gross,
          discountCents,
          refundCents,
          shippingChargedCents: 600,
          feeCents: 0, // recomputed by the rollup from shop fee config
          shippingCostCents: 0, // recomputed by the rollup from rules
          currency: "USD",
          countryCode: "US",
          totalWeightGrams: lines.reduce((s, l) => s + l.p.weight * l.qty, 0),
          discountCodes: discounted ? ["SUMMER20"] : [],
          test: false,
        },
      });

      const perLineDiscount = discountCents / lines.length;
      for (const [i, l] of lines.entries()) {
        await prisma.toloOrderLine.create({
          data: {
            orderRecordId: order.id,
            shopId: shop.id,
            variantId: `gid://shopify/ProductVariant/${l.p.pid}`,
            productId: `gid://shopify/Product/${l.p.pid}`,
            title: l.p.title,
            quantity: l.qty,
            revenueCents: Math.round(l.revenue - perLineDiscount),
            discountCents: Math.round(perLineDiscount),
            cogsCents: l.p.cost != null ? l.p.cost * l.qty : null,
            cogsMissing: l.p.cost == null,
            refundedQuantity: i === 0 && d === 3 ? 1 : 0,
            refundedCents: i === 0 && d === 3 ? l.revenue : 0,
          },
        });
      }
    }

    // Ad spend most days across two channels.
    if (d % 2 === 0) {
      await prisma.toloAdSpendEntry.create({
        data: {
          shopId: shop.id,
          channel: "meta",
          date: dayKey(d),
          amountCents: 2500,
        },
      });
    }
  }

  console.log("Computing rollups…");
  await toloRollupRange(SHOP_DOMAIN, dayKey(30), dayKey(0));
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
