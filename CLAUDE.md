# tolo_profit_analyzer.md — Tolo Profit Analyzer for Shopify

> Source of truth for AI-assisted development of this project.
> Read fully before writing code. Follow the conventions, respect the architecture,
> and update the task checklists as work is completed.
> Stack verified against Shopify's official recommendations as of July 2026.

---

## 1. Project Overview

**Product name:** Tolo Profit Analyzer
**One-liner:** Shopify shows merchants sales. Tolo shows them **profit** — real profit, per product, per day — with alerts when margins slip.

**The core insight:** Every merchant sees revenue in Shopify admin. Almost none know their actual profit because it lives across five places: product costs, shipping bills, ad accounts, discount reports, and returns. Tolo pulls it into one number.

**Target users:** Shopify merchants doing $5k–$500k/month who make pricing and ad decisions on gut feel.

**Positioning rule for every screen:** never show a revenue number without a profit number next to it. Revenue is Shopify's job; profit is ours.

---

## 2. Feature Set

### 2.1 Cost Inputs (what the merchant provides)

| Input | How it's captured | Improvement over "merchant enters everything" |
|---|---|---|
| **Product cost (COGS)** | Auto-imported from Shopify's `InventoryItem.unitCost` where set; editable in a bulk cost editor; per-variant; cost history with effective dates so old orders keep old costs. | Most merchants already set cost in Shopify — import it, don't make them retype it. |
| **Shipping cost** | Rule-based: flat per order, per item, by weight band, or by country zone. Optional per-order override. | Merchants can't enter shipping per order manually at scale — rules make it sustainable. |
| **Ad spend** | Manual daily/period entry per channel (Meta, Google, TikTok, Other) in MVP. Direct API integrations in Phase 4. | Spend is allocated to profit by day, proportional to revenue. |
| **Discounts** | **Automatic** — already on every Shopify order (`totalDiscountsSet`). Merchant enters nothing. | |
| **Returns/refunds** | **Automatic** — pulled from Shopify refund objects via webhooks. Merchant enters nothing. | |
| **Transaction fees** | Auto-estimated from payment gateway rates (configurable %, defaults to Shopify Payments rates for the store's plan). | The #1 cost merchants forget. Including it is a differentiator. |

### 2.2 Dashboard (what the merchant sees)

| Feature | Description | Priority |
|---|---|---|
| **Real Profit Overview** | Today / 7d / 30d / custom range: net revenue → minus COGS → minus shipping → minus fees → minus ad spend → **net profit + margin %**. Shown as a waterfall so merchants *see where money goes*. | P0 |
| **Best Products** | Ranked by total profit contribution (not revenue). Shows profit per unit, margin %, units sold. | P0 |
| **Worst Products** | Products losing money or below margin threshold — including "popular but unprofitable" traps (high revenue, negative margin after discounts/returns). | P0 |
| **Margin Alerts** | Merchant sets a floor (e.g., 25%). Daily check flags products that dropped below it, with the *reason* (cost rose? discounting? returns spike?). In-app + email. | P0 |
| **Profit Trend Chart** | Daily profit + margin line over time (Polaris Viz). | P0 |
| **Cost Completeness Meter** | "You've set costs for 82% of your catalog (covers 95% of revenue)." Drives setup completion — accuracy is the product. | P0 |
| **Discount Impact View** | Profit with vs. without discounts, per discount code. Answers "is my 20% code actually making money?" | P1 |
| **Returns Impact View** | Profit lost to returns, per product. Flags return-heavy products. | P1 |
| **Weekly Profit Email** | Monday summary: last week's profit, top 3 winners, top 3 losers, one recommended action. | P1 |
| **True ROAS** | Ad spend vs. *profit* (not revenue): break-even ROAS per product category. | P2 |
| **CSV Export** | Full profit report export for accountants. | P2 |

### 2.3 Non-Goals (do not build)
- Accounting/bookkeeping (no P&L statements, no tax categories, no QuickBooks sync in v1).
- Inventory forecasting.
- Multi-currency consolidation beyond presenting in store currency (converted at order-time rates from Shopify's `presentmentMoney`/`shopMoney`).

---

## 3. Pricing

| Plan | Price | Limits |
|---|---|---|
| **Basic** | $9/mo | Up to 100 orders/mo, dashboard + best/worst products |
| **Growth** | $29/mo | Up to 1,000 orders/mo, + margin alerts, discount & returns views, weekly email |
| **Pro** | $79/mo | Unlimited orders, + true ROAS, CSV export, 24-month history, priority sync |

- 14-day free trial on all plans (long enough to see a real weekly report — the aha moment).
- Managed entirely via Shopify Billing (managed pricing or Billing API through the app package).
- Order-count gates enforced server-side.

---

## 4. Tech Stack (Shopify's Recommended Stack)

This project uses Shopify's **official app template and first-party tooling** — the path Shopify actively maintains, documents, and reviews fastest.

### 4.1 Framework & Language
- **React Router v7 (framework mode) + TypeScript (strict)** — Shopify's current official app template (`shopify-app-template-react-router`, successor to the Remix template). Full-stack: loaders/actions on the server, React on the client, one codebase.
- **Scaffold:** `shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router`
- **Node.js 22 LTS**

### 4.2 Shopify Integration
- **`@shopify/shopify-app-react-router`** — OAuth, embedded session-token auth (`authenticate.admin`), webhook processing (`authenticate.webhook`), billing helpers, GraphQL Admin API client (`admin.graphql`).
- **App Bridge (latest, script-tag based)** — embedding, toasts, modals, `TitleBar`, navigation.
- **Polaris Web Components (`<s-page>`, `<s-section>`, `<s-table>`, …)** — Shopify's current standard UI layer in the template; use these over legacy Polaris React for new screens.
- **Polaris Viz (`@shopify/polaris-viz`)** — Shopify's own charting library for the profit trend/waterfall charts; matches admin look & feel.
- **GraphQL Admin API only**, version pinned in `shopify.app.toml` mindset — one `graphql/` directory with typed operations via `graphql-codegen`.
- **Bulk Operations API** for historical order import (90 days on install; 24 months for Pro).
- **Webhooks declared in `shopify.app.toml`** (Shopify best practice — auto-synced on every `deploy`, no afterAuth registration drift): `orders/create`, `orders/updated`, `refunds/create`, `products/update`, `app/uninstalled`, `app_subscriptions/update` + GDPR mandatory: `customers/data_request`, `customers/redact`, `shop/redact`.

### 4.3 Data Layer
- **Prisma ORM** (ships with the template) — schema in `prisma/schema.prisma`.
- **SQLite in development** (template default) → **PostgreSQL in production** (managed: Neon/Supabase/Cloud SQL). The template's SQLite is single-instance only; Postgres from day one of staging.
- **Session storage:** `@shopify/shopify-app-session-storage-prisma` (template default).

### 4.4 Background Work
- **BullMQ + Redis** for queues (order sync jobs, bulk imports, nightly rollups, alert evaluation). Workers run in the same deployment as a separate process (`npm run worker`).
- **Scheduling:** BullMQ repeatable jobs (daily rollup at 02:00 UTC per shop-timezone batch; alert check after rollup; weekly email Mondays).
- Rule: webhook handlers do **no computation** — they enqueue and return 200 immediately (Shopify retires slow webhook endpoints).

### 4.5 Quality & Tooling
- **Vitest** + Testing Library (the app package ships `testConfig()` test helpers — use them).
- **ESLint + Prettier**, TypeScript `strict: true`, no `any` in `app/services/`.
- **graphql-codegen** — every Admin API operation is typed; never hand-write response types.
- **Shopify Dev MCP** — the template pre-configures it for Claude Code/Cursor/Copilot. AI assistants MUST use it to validate GraphQL fields instead of guessing.
- **Sentry** for errors (server + client).

### 4.6 Deployment
- **Fly.io** (or Google Cloud Run) using the template's Dockerfile; `NODE_ENV=production`.
- Two processes: `web` (React Router server) + `worker` (BullMQ).
- Managed Postgres + managed Redis (Upstash/Fly Redis).
- **GitHub Actions:** lint → typecheck → test → `shopify app deploy` (syncs toml/webhooks) → deploy containers.

---

## 5. Architecture

```
┌────────────────────────── Shopify Admin ─────────────────────────────┐
│  Embedded App — React Router v7 routes under app/routes/app.*       │
│  ├── app._index        → Profit Dashboard (waterfall, trend, KPIs)  │
│  ├── app.products      → Best/Worst products table                  │
│  ├── app.costs         → Bulk COGS editor + import from Shopify     │
│  ├── app.costs.shipping→ Shipping cost rules                        │
│  ├── app.adspend       → Ad spend entry (per channel, per period)   │
│  ├── app.alerts        → Margin alert settings + alert feed         │
│  └── app.settings      → Fees config, plan/billing, export          │
│  UI: Polaris Web Components + Polaris Viz + App Bridge              │
└──────────────┬────────────────────────────────────────────────────────┘
               │ loaders/actions (authenticate.admin, session tokens)
┌──────────────▼────────────────────────────────────────────────────────┐
│  React Router server (Node 22)                                       │
│  ├── app/shopify.server.ts   — shopifyApp() config                   │
│  ├── app/routes/webhooks.*   — authenticate.webhook → enqueue only   │
│  ├── app/services/                                                   │
│  │     ├── sync/       (bulk import, incremental order/refund sync)  │
│  │     ├── costs/      (COGS history, shipping rules, fee config)    │
│  │     ├── profit/ (ToloProfitEngine — the ONLY place formulas live) │
│  │     ├── alerts/     (margin evaluation, alert lifecycle)          │
│  │     ├── reports/    (weekly email payloads, CSV export)           │
│  │     └── billing/    (plan gates, order-count limits)              │
│  └── app/jobs/          — BullMQ job definitions                     │
├────────────────────────────────────────────────────────────────────────┤
│  Prisma → PostgreSQL   │   BullMQ → Redis   │   Postmark (email)     │
└────────────────────────────────────────────────────────────────────────┘
```

**Profit formula (canonical — implemented once in `ToloProfitEngine`):**
```
netRevenue   = grossSales − discounts − refunds
totalCosts   = cogs + shippingCost + transactionFees + allocatedAdSpend
netProfit    = netRevenue − totalCosts
margin       = netProfit / netRevenue
```
Rules:
1. Money is **integer cents** end-to-end (Prisma `Int`/`BigInt`). Floats are forbidden in money paths.
2. COGS is resolved from the cost **effective at order time** (cost history table), not the current cost.
3. Ad spend is a shop-level daily figure allocated to products proportional to that day's revenue share.
4. Every dashboard number must be reproducible from `tolo_order_lines` + cost tables — rollups are caches, never sources of truth.
5. Orders with missing COGS are flagged, not silently treated as zero-cost; the Cost Completeness Meter reflects this.

---

## 6. Database Schema (Prisma models, core)

```
Session              (template default — Shopify sessions; name owned by the
                      template, so no Tolo prefix)
ToloShop             (id, shopDomain, currency, ianaTimezone, plan, trialEndsAt,
                      feeRatePercent, feeFixedCents, installedAt, uninstalledAt)
ToloProductCost      (id, shopId, variantId, productId, costCents,
                      effectiveFrom, source[shopify_import|manual], createdAt)
ToloShippingRule     (id, shopId, kind[flat_order|per_item|weight_band|zone],
                      config Json, priority, active)
ToloAdSpendEntry     (id, shopId, channel[meta|google|tiktok|other],
                      date, amountCents, note)
ToloOrderRecord      (id, shopId, shopifyOrderId, processedAt, grossCents,
                      discountCents, refundCents, shippingChargedCents,
                      feeCents, currency)
ToloOrderLine        (id, orderRecordId, variantId, productId, quantity,
                      revenueCents, cogsCents, cogsMissing Boolean)
ToloDailyProfit      (shopId, date, grossCents, discountCents, refundCents,
                      cogsCents, shippingCostCents, feeCents, adSpendCents,
                      netProfitCents, marginBps)      — rollup cache
ToloProductDailyProfit (shopId, productId, date, ...same shape)
ToloAlertRule        (id, shopId, marginFloorBps, channels Json, active)
ToloAlert            (id, shopId, productId, date, kind[margin_drop|negative|
                      returns_spike], detail Json, status[new|seen|resolved])
```
- Tables map to snake_case with the prefix via `@@map` (e.g. `ToloOrderLine` → `tolo_order_lines`).
- `@@index([shopId, date])` on all rollups; every query is shop-scoped — a Prisma client extension injects `shopId` filtering to make cross-tenant leaks structurally impossible.
- `shop/redact` → hard-delete all shop rows via job within 30 days, with audit log.

---

## 7. Conventions & Best Practices (Shopify-stack specific)

1. **Embedded-app iron rules** (from Shopify's template docs): use `Link` from `react-router`/Polaris — never `<a>`; use the `redirect` returned by `authenticate.admin` — never React Router's own `redirect` for admin routes; use `useSubmit`/`fetcher` for mutations.
2. **All admin routes nest under `app/routes/app.tsx`** so they inherit App Bridge init, auth, error boundaries, and required headers. Webhook and auth routes live outside it.
3. **Webhooks in `shopify.app.toml`**, never registered in `afterAuth` — deploy keeps them in sync automatically.
4. **Loaders read, actions write, services compute.** No business logic in route files; `ToloProfitEngine` is pure and unit-tested with table-driven cases.
5. **GraphQL:** typed via codegen; respect cost-based rate limits through a single client wrapper with backoff; pin API version and review quarterly.
6. **Money:** integer cents everywhere; format only at the UI edge with `Intl.NumberFormat` in the shop's currency.
7. **Testing minimums:** ToloProfitEngine 100% branch coverage; every webhook handler has an enqueue test; every loader has an auth test using `testConfig()`.
8. **AI-assisted dev:** use the Shopify Dev MCP to verify every Admin API field/mutation before use. Never invent GraphQL fields. Update this file in the same PR when reality diverges from it.
9. **`Tolo` prefix on everything we author.** Every app-specific named thing we write carries the prefix:
   - `Tolo` (PascalCase) for classes, services, jobs, Prisma models, and custom components — `ToloProfitEngine`, `ToloOrderSyncJob`, `ToloOrderRecord`.
   - `tolo-` / `tolo_` (kebab/snake case) for CSS classes, DB table names (`@@map`), queue names, custom event names, storage keys, and metafield namespaces — `tolo-cost-editor`, `tolo_order_lines`, `tolo:order-sync`.
   - **Exceptions:** names dictated by the framework, template, or Shopify — route filenames (`app.costs.tsx`), the template's `Session` model, webhook topics, `shopify.app.toml` keys. Don't fight required naming.
   The point: anything grep-able as ours starts with `tolo`, and our names can never collide with Shopify, Polaris, or library names.

---

## 8. Implementation Plan — Tasks & Subtasks

### Phase 0 — Foundation (Week 1)
- [ ] **0.1 Scaffold from official template**
  - [ ] `shopify app init --template=...shopify-app-template-react-router` (TypeScript)
  - [ ] Enable TS strict; add ESLint/Prettier config; set up graphql-codegen
  - [ ] Repo hygiene: `.env.example` documented, GitHub Actions (lint/typecheck/test)
- [ ] **0.2 App configuration**
  - [ ] Partner app; scopes: `read_orders, read_products, read_inventory` (add `read_returns` if needed by API version)
  - [ ] Declare all webhooks (incl. GDPR trio) in `shopify.app.toml`
  - [ ] Dev store seeded with products (with and without `unitCost`), orders, discounts, and refunds — the test fixtures ARE the product here
- [ ] **0.3 Infrastructure**
  - [ ] Prisma → Postgres for staging/prod; SQLite locally
  - [ ] Redis + BullMQ wiring; `worker` process entrypoint; Fly.io (web + worker) deploy pipeline
  - [ ] Sentry on server + client

### Phase 1 — Data Ingestion (Weeks 2–3)
- [ ] **1.1 Order & refund sync**
  - [ ] Webhook routes (`orders/create`, `orders/updated`, `refunds/create`) → enqueue-only handlers
  - [ ] `ToloOrderSyncJob`: fetch full order via typed GraphQL → upsert `ToloOrderRecord` + `ToloOrderLine` (integer cents, order-time currency amounts)
  - [ ] Refund application: adjust `refundCents` + per-line quantities
- [ ] **1.2 Historical import**
  - [ ] Bulk Operations job: 90 days of orders on install (24 months for Pro plan)
  - [ ] Progress state surfaced to onboarding UI (poll a status loader)
  - [ ] Nightly reconciliation job (webhooks aren't guaranteed) — diff last 3 days against API
- [ ] **1.3 Product catalog sync**
  - [ ] Import products/variants incl. `InventoryItem.unitCost` → seed `ToloProductCost` rows (`source: shopify_import`)
  - [ ] `products/update` webhook keeps catalog + imported costs fresh (never overwrite manual costs)
- [ ] **1.4 GDPR + uninstall**
  - [ ] GDPR webhook handlers + deletion job + audit log
  - [ ] `app/uninstalled`: mark shop, cancel queued jobs, schedule data purge

### Phase 2 — Cost Inputs (Weeks 4–5)
- [ ] **2.1 COGS editor** (`app.costs`)
  - [ ] Bulk table: all variants, current cost, source badge, inline edit (Polaris Web Components `<s-table>`)
  - [ ] "Import from Shopify" action + CSV upload for bulk cost import
  - [ ] Cost history: edits create a new `ToloProductCost` row with `effectiveFrom` (backdating supported with a warning that history recomputes)
  - [ ] Cost Completeness Meter: % of catalog and % of trailing-30d revenue covered
- [ ] **2.2 Shipping rules** (`app.costs.shipping`)
  - [ ] Rule builder: flat/order, per-item, weight bands, country zones; priority ordering; test-an-order preview
  - [ ] `ToloShippingCostResolver` in ToloProfitEngine with unit tests per rule kind
- [ ] **2.3 Transaction fees**
  - [ ] Settings: gateway % + fixed fee (defaults: Shopify Payments standard rates); applied per order
- [ ] **2.4 Ad spend entry** (`app.adspend`)
  - [ ] Quick entry: channel + date-or-range + amount; monthly amounts auto-split per day
  - [ ] Editable history table; daily totals feed allocation

### Phase 3 — Profit Engine & Dashboard (Weeks 6–8)
- [ ] **3.1 ToloProfitEngine (pure, table-test-driven)**
  - [ ] Per-line COGS resolution from cost history (order-time effective cost); `cogsMissing` flagging
  - [ ] Order-level: net revenue, shipping cost, fees; day-level ad-spend allocation by revenue share
  - [ ] 100% branch coverage; golden-file tests against seeded dev-store fixtures
- [ ] **3.2 Rollups**
  - [ ] Nightly `ToloDailyProfit` + `ToloProductDailyProfit` rollup job (idempotent, recompute-on-demand when costs backdated)
  - [ ] Recompute queue with per-shop debounce (cost edit → recompute affected range only)
- [ ] **3.3 Dashboard** (`app._index`)
  - [ ] KPI header: net profit, margin %, vs previous period (range picker: today/7d/30d/custom)
  - [ ] Profit waterfall (Polaris Viz): revenue → discounts → refunds → COGS → shipping → fees → ads → profit
  - [ ] Daily profit + margin trend chart
  - [ ] Missing-cost banner linking to COGS editor when completeness < 90% of revenue
- [ ] **3.4 Best / Worst products** (`app.products`)
  - [ ] Sortable table: profit contribution, margin %, units, revenue, returns %
  - [ ] "Losing money" filter (negative margin) + "popular but unprofitable" flag (top-quartile revenue, bottom-quartile margin)
  - [ ] Product drill-down: per-product trend + cost breakdown

### Phase 4 — Alerts & Reports (Weeks 9–10)
- [ ] **4.1 Margin alerts** (`app.alerts`)
  - [ ] Alert rule settings (margin floor, channels: in-app/email)
  - [ ] Daily evaluation job after rollup: margin_drop / negative / returns_spike detectors, each with computed *reason* (cost↑, discount↑, returns↑)
  - [ ] Alert feed UI with seen/resolved lifecycle; dedupe (one alert per product per condition per week)
- [ ] **4.2 Discount & returns impact views**
  - [ ] Per-discount-code profit table (profit with vs without the code)
  - [ ] Returns impact: profit lost per product, return-rate outliers
- [ ] **4.3 Weekly profit email**
  - [ ] Postmark template: profit, winners, losers, one action; Monday 08:00 shop-local; unsubscribe honored
- [ ] **4.4 CSV export** — dashboard-range export of order-level and product-level profit (Pro)

### Phase 5 — Billing & Launch (Weeks 11–12)
- [ ] **5.1 Billing**
  - [ ] Three plans + 14-day trial via the app package's billing helpers; `app_subscriptions/update` webhook syncs plan state
  - [ ] Order-count gates (Basic/Growth) enforced in sync pipeline with graceful "upgrade" UX, never silent data loss
- [ ] **5.2 Onboarding**
  - [ ] 3-step: install → import running (progress) → set costs (import + top-revenue-first editor) → first dashboard
  - [ ] Empty states everywhere; sample-mode screenshot for pre-import
- [ ] **5.3 App Store submission**
  - [ ] Built for Shopify checklist pass (embedded, Polaris, App Bridge, performance)
  - [ ] Listing (screenshots of waterfall + worst-products — the money shots), privacy policy, data-handling doc
  - [ ] Load test: 1k-order backfill and webhook burst
- [ ] **5.4 Beta** — 15–25 merchants; instrument: cost-completeness at day 3, dashboard WAU, alert open rate, trial→paid

### Phase 6 — Post-Launch Growth (Weeks 13+)
- [ ] **6.1 Ad platform integrations** — Meta + Google OAuth, auto-pull daily spend (replaces manual entry; keep manual as fallback)
- [ ] **6.2 True ROAS view** — profit-based ROAS + per-product break-even ROAS
- [ ] **6.3 24-month history** (Pro) + year-over-year comparisons
- [ ] **6.4 Anomaly detection** — sudden margin shifts flagged without a configured rule
- [ ] **6.5 Accountant export pack** — monthly summarized CSV bundle

---

## 9. Security & Compliance Checklist
- [ ] Webhook HMAC verification (handled by `authenticate.webhook` — never bypass)
- [ ] Session-token auth on every admin route (`authenticate.admin` in every loader/action)
- [ ] Shop-scoped Prisma extension prevents cross-tenant queries
- [ ] No customer PII stored (orders stripped to financial fields; no names/emails/addresses)
- [ ] GDPR webhooks implemented + tested before submission
- [ ] Secrets only via env; Redis + Postgres over TLS in production

## 10. Success Metrics
- **Activation:** % of installs reaching ≥80% revenue-weighted cost completeness in 7 days (target > 60%)
- **Aha moment:** % who view the waterfall with real data in first session (target > 75%)
- **Retention:** M1 subscriber retention (target > 85% — profit data compounds in value)
- **Trial→paid:** target > 35%
- **Alert engagement:** alert → product page click-through (target > 40%)

---

## 11. Notes for the AI Assistant Working on This Repo
1. Work the earliest unchecked task unless directed otherwise; check the box and update this file in the same PR.
2. Use the Shopify Dev MCP to validate every GraphQL field, mutation, and webhook topic — never rely on memory for the Admin API.
3. All money math in integer cents inside `ToloProfitEngine` only. If you find a profit calculation anywhere else, that's a bug — move it.
4. Follow the embedded-app iron rules in §7.1 without exception; violations fail App Store review.
5. Webhook handlers enqueue and return. If a handler takes more than a DB write, it belongs in a job.
6. Every app-specific class, model, job, component, CSS class, or other named thing you author gets the `Tolo`/`tolo` prefix per §7.9 — no exceptions beyond the framework-dictated names listed there.
