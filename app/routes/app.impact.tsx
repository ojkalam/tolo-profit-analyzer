import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { toloAppContext } from "../services/tolo-app-context.server";
import {
  toloResolveRange,
  type ToloRangeKey,
} from "../services/profit/tolo-profit-queries.server";
import {
  toloDiscountImpact,
  toloReturnsImpact,
} from "../services/reports/tolo-impact.server";
import { toloCanUseImpactViews } from "../services/billing/tolo-billing.server";
import { toloFormatCents, toloProfitTone } from "../services/profit/tolo-format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get("range") as ToloRangeKey) ?? "30d";
  const validKey: ToloRangeKey = ["today", "7d", "30d"].includes(rangeKey)
    ? rangeKey
    : "30d";
  const range = toloResolveRange(shop, validKey);
  const [discounts, returns] = await Promise.all([
    toloDiscountImpact(shop.id, range),
    toloReturnsImpact(shop.id, range),
  ]);
  return {
    currency: shop.currency,
    rangeKey: validKey,
    discounts,
    returns,
    entitled: toloCanUseImpactViews(shop.plan),
    plan: shop.plan,
  };
};

export default function ToloImpactPage() {
  const { currency, rangeKey, discounts, returns, entitled, plan } =
    useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  return (
    <s-page heading="Discount & returns impact">
      <s-select
        slot="primary-action"
        label=""
        labelAccessibilityVisibility="exclusive"
        value={rangeKey}
        onChange={(e) =>
          setSearchParams((prev) => {
            prev.set("range", e.currentTarget.value);
            return prev;
          })
        }
      >
        <s-option value="today">Today</s-option>
        <s-option value="7d">Last 7 days</s-option>
        <s-option value="30d">Last 30 days</s-option>
      </s-select>

      {!entitled && (
        <s-banner tone="info" heading="Impact views are a Growth feature">
          <s-paragraph>
            You&apos;re on the {plan} plan — these run during your trial.{" "}
            <s-link href="/app/settings">See plans →</s-link>
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="Discount codes — is each one making money?">
        {discounts.length === 0 ? (
          <s-paragraph>No discounted orders in this range.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Code</s-table-header>
              <s-table-header>Orders</s-table-header>
              <s-table-header>Discount given</s-table-header>
              <s-table-header>Profit with code</s-table-header>
              <s-table-header>Profit if undiscounted</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {discounts.map((row) => (
                <s-table-row key={row.code}>
                  <s-table-cell>
                    <s-badge>{row.code}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{row.orders}</s-table-cell>
                  <s-table-cell>
                    {toloFormatCents(row.discountCents, currency)}
                  </s-table-cell>
                  <s-table-cell>
                    <s-text
                      type={
                        toloProfitTone(row.profitWithCents) === "critical"
                          ? "strong"
                          : "generic"
                      }
                    >
                      {toloFormatCents(row.profitWithCents, currency)}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    {toloFormatCents(row.profitWithoutCents, currency)}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Returns — profit lost per product">
        {returns.length === 0 ? (
          <s-paragraph>No returns in this range. 🎉</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Refunded</s-table-header>
              <s-table-header>Return rate</s-table-header>
              <s-table-header>Units returned</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {returns.map((row) => (
                <s-table-row key={row.productId}>
                  <s-table-cell>
                    <s-link
                      href={`/app/products/${encodeURIComponent(row.productId)}?range=${rangeKey}`}
                    >
                      {row.title}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    {toloFormatCents(row.refundCents, currency)}
                  </s-table-cell>
                  <s-table-cell>
                    {row.returnRatePct > 15 ? (
                      <s-badge tone="critical">{row.returnRatePct}%</s-badge>
                    ) : (
                      `${row.returnRatePct}%`
                    )}
                  </s-table-cell>
                  <s-table-cell>{row.refundedUnits}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
