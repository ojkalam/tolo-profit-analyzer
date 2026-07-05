-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_shops" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ianaTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "trialEndsAt" TIMESTAMP(3),
    "feeRateBps" INTEGER NOT NULL DEFAULT 290,
    "feeFixedCents" INTEGER NOT NULL DEFAULT 30,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "importStatus" TEXT NOT NULL DEFAULT 'pending',
    "importProgress" INTEGER NOT NULL DEFAULT 0,
    "bulkOperationId" TEXT,
    "catalogSyncedAt" TIMESTAMP(3),
    "weeklyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notificationEmail" TEXT,

    CONSTRAINT "tolo_shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_variants" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "weightGrams" INTEGER NOT NULL DEFAULT 0,
    "inventoryItemId" TEXT,
    "productStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tolo_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_product_costs" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tolo_product_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_shipping_rules" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tolo_shipping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_ad_spend_entries" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tolo_ad_spend_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_order_records" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "day" TEXT NOT NULL,
    "grossCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "refundCents" INTEGER NOT NULL DEFAULT 0,
    "shippingChargedCents" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCostCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "countryCode" TEXT,
    "totalWeightGrams" INTEGER NOT NULL DEFAULT 0,
    "discountCodes" JSONB,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tolo_order_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_order_lines" (
    "id" TEXT NOT NULL,
    "orderRecordId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "cogsCents" INTEGER,
    "cogsMissing" BOOLEAN NOT NULL DEFAULT true,
    "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tolo_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_daily_profits" (
    "shopId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "grossCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "refundCents" INTEGER NOT NULL DEFAULT 0,
    "cogsCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCostCents" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "adSpendCents" INTEGER NOT NULL DEFAULT 0,
    "netRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "netProfitCents" INTEGER NOT NULL DEFAULT 0,
    "marginBps" INTEGER NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "unitsSold" INTEGER NOT NULL DEFAULT 0,
    "cogsMissingCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tolo_daily_profits_pkey" PRIMARY KEY ("shopId","date")
);

-- CreateTable
CREATE TABLE "tolo_product_daily_profits" (
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "grossCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "refundCents" INTEGER NOT NULL DEFAULT 0,
    "cogsCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCostCents" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "adSpendCents" INTEGER NOT NULL DEFAULT 0,
    "netRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "netProfitCents" INTEGER NOT NULL DEFAULT 0,
    "marginBps" INTEGER NOT NULL DEFAULT 0,
    "unitsSold" INTEGER NOT NULL DEFAULT 0,
    "refundedUnits" INTEGER NOT NULL DEFAULT 0,
    "cogsMissing" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tolo_product_daily_profits_pkey" PRIMARY KEY ("shopId","productId","date")
);

-- CreateTable
CREATE TABLE "tolo_alert_rules" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "marginFloorBps" INTEGER NOT NULL DEFAULT 2500,
    "channels" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tolo_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_alerts" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
    "date" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tolo_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolo_audit_logs" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tolo_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tolo_shops_shopDomain_key" ON "tolo_shops"("shopDomain");

-- CreateIndex
CREATE INDEX "tolo_variants_shopId_productId_idx" ON "tolo_variants"("shopId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "tolo_variants_shopId_variantId_key" ON "tolo_variants"("shopId", "variantId");

-- CreateIndex
CREATE INDEX "tolo_product_costs_shopId_variantId_effectiveFrom_idx" ON "tolo_product_costs"("shopId", "variantId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "tolo_shipping_rules_shopId_priority_idx" ON "tolo_shipping_rules"("shopId", "priority");

-- CreateIndex
CREATE INDEX "tolo_ad_spend_entries_shopId_date_idx" ON "tolo_ad_spend_entries"("shopId", "date");

-- CreateIndex
CREATE INDEX "tolo_order_records_shopId_day_idx" ON "tolo_order_records"("shopId", "day");

-- CreateIndex
CREATE INDEX "tolo_order_records_shopId_processedAt_idx" ON "tolo_order_records"("shopId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tolo_order_records_shopId_shopifyOrderId_key" ON "tolo_order_records"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "tolo_order_lines_shopId_productId_idx" ON "tolo_order_lines"("shopId", "productId");

-- CreateIndex
CREATE INDEX "tolo_order_lines_orderRecordId_idx" ON "tolo_order_lines"("orderRecordId");

-- CreateIndex
CREATE INDEX "tolo_daily_profits_shopId_date_idx" ON "tolo_daily_profits"("shopId", "date");

-- CreateIndex
CREATE INDEX "tolo_product_daily_profits_shopId_date_idx" ON "tolo_product_daily_profits"("shopId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "tolo_alert_rules_shopId_key" ON "tolo_alert_rules"("shopId");

-- CreateIndex
CREATE INDEX "tolo_alerts_shopId_status_idx" ON "tolo_alerts"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tolo_alerts_shopId_productId_kind_weekKey_key" ON "tolo_alerts"("shopId", "productId", "kind", "weekKey");

-- CreateIndex
CREATE INDEX "tolo_audit_logs_shopDomain_idx" ON "tolo_audit_logs"("shopDomain");

-- AddForeignKey
ALTER TABLE "tolo_order_lines" ADD CONSTRAINT "tolo_order_lines_orderRecordId_fkey" FOREIGN KEY ("orderRecordId") REFERENCES "tolo_order_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
