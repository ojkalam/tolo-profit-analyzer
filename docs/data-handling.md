# Tolo Profit Analyzer — Data Handling (App Store review)

This document summarizes how Tolo handles data for Shopify App Store review and
the Built for Shopify checklist.

## Scopes and justification

| Scope | Why |
|---|---|
| `read_orders` | Compute profit from order financials (gross, discounts, refunds, line items). |
| `read_products` | Map line items to products/variants; power the cost editor. |
| `read_inventory` | Import `InventoryItem.unitCost` as COGS so merchants don't retype it. |

No write scopes are requested.

## Data flow

1. **Webhooks** (`orders/create`, `orders/updated`, `refunds/create`,
   `products/update`) are HMAC-verified by `authenticate.webhook` and enqueue a
   job — no computation in the handler.
2. **Jobs** (BullMQ, or inline in dev) fetch full records via the GraphQL Admin
   API and upsert normalized, integer-cent rows. Orders are stripped to
   financial fields; **no customer PII is persisted**.
3. **ProfitEngine** (pure, unit-tested) computes profit; nightly rollups cache
   daily and per-product totals. Every number is reproducible from order lines +
   cost tables.

## Tenancy isolation

Every row is shop-scoped. A Prisma client extension (`toloShopDb`) injects a
`shopId` filter on list/aggregate/create operations for shop-scoped models,
making cross-tenant reads structurally impossible in those paths. Composite
unique keys embed `shopId`.

## PII posture

- Stored: financial amounts (integer cents), product/variant IDs, dates,
  destination country code, merchant-entered costs and ad spend.
- Not stored: customer names, emails, addresses, payment details.

## Compliance webhooks

`customers/data_request`, `customers/redact`, `shop/redact` are implemented.
Because no customer PII is stored, data-request and customer-redact are logged
for audit; `shop/redact` hard-deletes all shop data within 30 days.

## Security

- Session-token auth on every admin route (`authenticate.admin`).
- Secrets via environment only; Postgres and Redis over TLS in production.
- Errors reported to Sentry without customer PII.

## Built for Shopify

- Embedded, session-token authenticated, App Bridge navigation.
- Polaris web components + Polaris-styled charts.
- Webhooks declared in `shopify.app.toml` (synced on deploy).
- Performance: webhook handlers enqueue and return; heavy work runs in jobs.
