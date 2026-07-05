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
  toloRoasByChannel,
  toloRoasSummary,
} from "../services/profit/tolo-roas.server";
import { toloCanUseRoas } from "../services/billing/tolo-billing.server";
import { toloFormatCents } from "../services/profit/tolo-format";
import { ToloStat } from "../components/tolo-charts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get("range") as ToloRangeKey) ?? "30d";
  const validKey: ToloRangeKey = ["today", "7d", "30d"].includes(rangeKey)
    ? rangeKey
    : "30d";
  const range = toloResolveRange(shop, validKey);
  const [summary, channels] = await Promise.all([
    toloRoasSummary(shop.id, range),
    toloRoasByChannel(shop.id, range),
  ]);
  return {
    currency: shop.currency,
    rangeKey: validKey,
    summary,
    channels,
    entitled: toloCanUseRoas(shop.plan),
    plan: shop.plan,
  };
};

const roas = (n: number) => `${n.toFixed(2)}×`;

export default function ToloRoasPage() {
  const { currency, rangeKey, summary, channels, entitled, plan } =
    useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  const beatingBreakEven = summary.revenueRoas >= summary.breakEvenRoas;

  return (
    <s-page heading="True ROAS">
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
        <s-banner tone="info" heading="True ROAS is a Pro feature">
          <s-paragraph>
            You&apos;re on the {plan} plan — this previews during your trial.{" "}
            <s-link href="/app/settings">Upgrade to Pro →</s-link>
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="Ad spend vs profit">
        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
          <ToloStat
            label="Profit ROAS (true)"
            value={roas(summary.profitRoas)}
            caption="profit before ads ÷ ad spend"
            tone={summary.profitRoas >= 1 ? "success" : "critical"}
          />
          <ToloStat
            label="Revenue ROAS"
            value={roas(summary.revenueRoas)}
            caption="net revenue ÷ ad spend"
          />
          <ToloStat
            label="Break-even ROAS"
            value={roas(summary.breakEvenRoas)}
            caption={`margin ${(summary.contributionMarginRatio * 100).toFixed(0)}%`}
          />
          <ToloStat
            label="Ad spend"
            value={toloFormatCents(summary.adSpendCents, currency)}
            caption={toloFormatCents(summary.netProfitCents, currency) + " net profit"}
          />
        </s-grid>
        <s-banner tone={beatingBreakEven ? "success" : "warning"}>
          <s-paragraph>
            {beatingBreakEven
              ? `Your ads clear break-even: revenue ROAS ${roas(summary.revenueRoas)} ≥ break-even ${roas(summary.breakEvenRoas)}.`
              : `Your ads are below break-even: you need a revenue ROAS of ${roas(summary.breakEvenRoas)} to profit, but you're at ${roas(summary.revenueRoas)}.`}
          </s-paragraph>
        </s-banner>
      </s-section>

      <s-section heading="Ad spend by channel">
        {channels.length === 0 ? (
          <s-paragraph>No ad spend recorded in this range.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Channel</s-table-header>
              <s-table-header>Ad spend</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {channels.map((c) => (
                <s-table-row key={c.channel}>
                  <s-table-cell>
                    <s-badge>{c.channel}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {toloFormatCents(c.adSpendCents, currency)}
                  </s-table-cell>
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
