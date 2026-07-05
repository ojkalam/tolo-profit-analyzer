# Tolo Profit Analyzer — Privacy Policy

_Last updated: 2026-07-05_

Tolo Profit Analyzer ("Tolo", "we") helps Shopify merchants understand their
profit. This policy explains what we access, what we store, and your rights.

## What we access

With your consent at install, Tolo requests these read-only Shopify scopes:

- `read_orders` — order financials (totals, discounts, refunds, line items)
- `read_products` — products and variants
- `read_inventory` — inventory item unit cost (your COGS, where you've set it)

Tolo never requests write access to your store.

## What we store

We store only the financial fields needed to compute profit:

- Order-level amounts in integer cents: gross, discounts, refunds, shipping
  charged, estimated fees; the order's processed date and destination country
  code (for shipping-cost rules).
- Line items: product/variant IDs, quantity, revenue, and cost.
- Your cost inputs: product costs, shipping rules, ad spend, fee configuration.
- Aggregated daily/product rollups derived from the above.

**We do not store customer personal information** — no names, emails,
addresses, or payment details. Orders are stripped to financial fields at
ingest.

## What we do not do

- We do not sell or share your data with third parties.
- We do not use your data to train models.
- We do not store customer PII (see GDPR handling below).

## Sub-processors

- Hosting: Fly.io (application + managed PostgreSQL + Redis)
- Email: Postmark (alert and weekly report emails, sent only to the address
  you configure)
- Error monitoring: Sentry (application errors; no customer PII)

## GDPR / data requests

Tolo implements Shopify's mandatory compliance webhooks:

- `customers/data_request` — we hold no customer PII, so there is nothing to
  return; the request is logged for audit.
- `customers/redact` — likewise, nothing to redact; logged for audit.
- `shop/redact` — all of your shop's data is hard-deleted within 30 days of
  uninstall, with an audit record of the deletion.

## Data retention

- History window follows your plan (90 days, or 24 months on Pro).
- On uninstall, data is scheduled for hard deletion within 30 days.

## Contact

Questions: privacy@toloapps.com
