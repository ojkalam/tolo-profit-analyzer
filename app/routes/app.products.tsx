import { useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { toloAppContext } from "../services/tolo-app-context.server";
import {
  toloProductProfit,
  toloResolveRange,
  type ToloRangeKey,
} from "../services/profit/tolo-profit-queries.server";
import {
  toloFormatBps,
  toloFormatCents,
  toloProfitTone,
} from "../services/profit/tolo-format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get("range") as ToloRangeKey) ?? "30d";
  const validKey: ToloRangeKey = ["today", "7d", "30d"].includes(rangeKey)
    ? rangeKey
    : "30d";
  const range = toloResolveRange(shop, validKey);
  const { rows, popularUnprofitable } = await toloProductProfit(shop.id, range);
  return {
    currency: shop.currency,
    rangeKey: validKey,
    rows,
    popularUnprofitable: [...popularUnprofitable],
  };
};

type Filter = "best" | "worst" | "losing" | "all";

export default function ToloProductsPage() {
  const { currency, rangeKey, rows, popularUnprofitable } =
    useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("best");
  const flagged = new Set(popularUnprofitable);

  const sorted = [...rows].sort(
    (a, b) => b.netProfitCents - a.netProfitCents,
  );
  let visible = sorted;
  if (filter === "best") visible = sorted.filter((r) => r.netProfitCents > 0);
  else if (filter === "worst")
    visible = [...sorted].reverse().filter((r) => r.netProfitCents <= 0);
  else if (filter === "losing")
    visible = sorted.filter((r) => r.netProfitCents < 0);

  return (
    <s-page heading="Products by profit">
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

      <s-section>
        <s-stack direction="inline" gap="small-500">
          {(
            [
              ["best", "Best"],
              ["worst", "Worst"],
              ["losing", "Losing money"],
              ["all", "All"],
            ] as Array<[Filter, string]>
          ).map(([key, label]) => (
            <s-button
              key={key}
              variant={filter === key ? "primary" : "tertiary"}
              onClick={() => setFilter(key)}
            >
              {label}
            </s-button>
          ))}
        </s-stack>
      </s-section>

      <s-section heading={`${visible.length} products`}>
        {visible.length === 0 ? (
          <s-paragraph>No products match this filter yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Net profit</s-table-header>
              <s-table-header>Margin</s-table-header>
              <s-table-header>Units</s-table-header>
              <s-table-header>Net revenue</s-table-header>
              <s-table-header>Return rate</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {visible.map((row) => (
                <s-table-row key={row.productId}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      <s-link
                        href={`/app/products/${encodeURIComponent(row.productId)}?range=${rangeKey}`}
                      >
                        {row.title}
                      </s-link>
                      {flagged.has(row.productId) && (
                        <s-badge tone="warning">Popular but unprofitable</s-badge>
                      )}
                      {row.cogsMissing && (
                        <s-badge tone="critical">Cost missing</s-badge>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text
                      type={
                        toloProfitTone(row.netProfitCents) === "critical"
                          ? "strong"
                          : "generic"
                      }
                    >
                      {toloFormatCents(row.netProfitCents, currency)}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>{toloFormatBps(row.marginBps)}</s-table-cell>
                  <s-table-cell>{row.unitsSold}</s-table-cell>
                  <s-table-cell>
                    {toloFormatCents(row.netRevenueCents, currency)}
                  </s-table-cell>
                  <s-table-cell>{row.returnRatePct}%</s-table-cell>
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
