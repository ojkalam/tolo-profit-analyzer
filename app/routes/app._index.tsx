import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { toloAppContext } from "../services/tolo-app-context.server";
import {
  toloPreviousRange,
  toloResolveRange,
  toloTotalsForRange,
  toloTrend,
  type ToloRangeKey,
} from "../services/profit/tolo-profit-queries.server";
import { toloCostCompleteness } from "../services/costs/tolo-costs.server";
import {
  toloFormatBps,
  toloFormatCents,
  toloProfitTone,
  toloDeltaLabel,
} from "../services/profit/tolo-format";
import {
  ToloStat,
  ToloTrendChart,
  ToloWaterfallChart,
  toloWaterfallSteps,
} from "../components/tolo-charts";

const RANGE_LABELS: Record<ToloRangeKey, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  custom: "Custom",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get("range") as ToloRangeKey) ?? "30d";
  const validKey: ToloRangeKey = ["today", "7d", "30d", "custom"].includes(
    rangeKey,
  )
    ? rangeKey
    : "30d";
  const range = toloResolveRange(shop, validKey, {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  const previous = toloPreviousRange(range);

  const [totals, prevTotals, trend, completeness] = await Promise.all([
    toloTotalsForRange(shop.id, range),
    toloTotalsForRange(shop.id, previous),
    toloTrend(shop.id, range),
    toloCostCompleteness(shop.id, shop.ianaTimezone),
  ]);

  return {
    currency: shop.currency,
    rangeKey: validKey,
    range,
    totals,
    prevTotals,
    trend,
    completeness,
    importStatus: shop.importStatus,
    importProgress: shop.importProgress,
  };
};

export default function ToloDashboard() {
  const {
    currency,
    rangeKey,
    range,
    totals,
    prevTotals,
    trend,
    completeness,
    importStatus,
    importProgress,
  } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  const steps = toloWaterfallSteps(totals);
  const hasData = totals.ordersCount > 0 || totals.adSpendCents > 0;

  return (
    <s-page heading="Profit dashboard">
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
        {(["today", "7d", "30d"] as ToloRangeKey[]).map((k) => (
          <s-option key={k} value={k}>
            {RANGE_LABELS[k]}
          </s-option>
        ))}
      </s-select>

      {importStatus === "running" && (
        <s-banner tone="info" heading="Importing your order history">
          <s-paragraph>
            Backfilling orders… {importProgress}% complete. Your dashboard fills
            in as data lands.
          </s-paragraph>
        </s-banner>
      )}

      {completeness.revenuePct < 90 && (
        <s-banner tone="warning" heading="Costs are incomplete">
          <s-paragraph>
            {completeness.revenuePct}% of the last 30 days&apos; revenue has a
            known cost. Profit below is an estimate until you finish setting
            costs.{" "}
            <s-link href="/app/costs">Set product costs →</s-link>
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading={`${RANGE_LABELS[rangeKey]} (${range.from} → ${range.to})`}>
        <s-grid
          gridTemplateColumns="1fr 1fr 1fr 1fr"
          gap="base"
        >
          <ToloStat
            label="Net profit"
            value={toloFormatCents(totals.netProfitCents, currency)}
            caption={toloDeltaLabel(
              totals.netProfitCents,
              prevTotals.netProfitCents,
            )}
            tone={toloProfitTone(totals.netProfitCents)}
          />
          <ToloStat
            label="Margin"
            value={toloFormatBps(totals.marginBps)}
            caption={toloDeltaLabel(totals.marginBps, prevTotals.marginBps)}
            tone={toloProfitTone(totals.marginBps)}
          />
          <ToloStat
            label="Net revenue"
            value={toloFormatCents(totals.netRevenueCents, currency)}
            caption={`${totals.ordersCount} orders`}
          />
          <ToloStat
            label="Ad spend"
            value={toloFormatCents(totals.adSpendCents, currency)}
            caption={`${totals.unitsSold} units sold`}
          />
        </s-grid>
      </s-section>

      {hasData ? (
        <>
          <s-section heading="Where the money goes">
            <ToloWaterfallChart steps={steps} currency={currency} />
          </s-section>
          <s-section heading="Daily profit trend">
            <ToloTrendChart data={trend} currency={currency} />
          </s-section>
        </>
      ) : (
        <s-section heading="No profit data yet">
          <s-paragraph>
            Once orders sync and costs are set, your profit waterfall and trend
            appear here.
          </s-paragraph>
          <s-button href="/app/costs">Set product costs</s-button>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
