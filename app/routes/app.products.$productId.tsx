import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { toloAppContext } from "../services/tolo-app-context.server";
import {
  toloProductDetail,
  toloResolveRange,
  type ToloRangeKey,
} from "../services/profit/tolo-profit-queries.server";
import prisma from "../db.server";
import {
  toloFormatBps,
  toloFormatCents,
  toloProfitTone,
} from "../services/profit/tolo-format";
import {
  ToloStat,
  ToloTrendChart,
  ToloWaterfallChart,
  toloWaterfallSteps,
} from "../components/tolo-charts";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const productId = decodeURIComponent(params.productId ?? "");
  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get("range") as ToloRangeKey) ?? "30d";
  const validKey: ToloRangeKey = ["today", "7d", "30d"].includes(rangeKey)
    ? rangeKey
    : "30d";
  const range = toloResolveRange(shop, validKey);

  const [{ totals, trend }, variant] = await Promise.all([
    toloProductDetail(shop.id, productId, range),
    prisma.toloVariant.findFirst({
      where: { shopId: shop.id, productId },
      select: { productTitle: true },
    }),
  ]);

  return {
    currency: shop.currency,
    title: variant?.productTitle ?? "Product",
    rangeKey: validKey,
    totals,
    trend,
  };
};

export default function ToloProductDetailPage() {
  const { currency, title, rangeKey, totals, trend } =
    useLoaderData<typeof loader>();
  const steps = toloWaterfallSteps(totals);

  return (
    <s-page heading={title}>
      <s-button slot="primary-action" href={`/app/products?range=${rangeKey}`}>
        Back to products
      </s-button>

      <s-section heading="Profit">
        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
          <ToloStat
            label="Net profit"
            value={toloFormatCents(totals.netProfitCents, currency)}
            tone={toloProfitTone(totals.netProfitCents)}
          />
          <ToloStat label="Margin" value={toloFormatBps(totals.marginBps)} />
          <ToloStat label="Units sold" value={String(totals.unitsSold)} />
          <ToloStat
            label="Net revenue"
            value={toloFormatCents(totals.netRevenueCents, currency)}
          />
        </s-grid>
      </s-section>

      <s-section heading="Cost breakdown">
        <ToloWaterfallChart steps={steps} currency={currency} />
      </s-section>

      <s-section heading="Daily trend">
        <ToloTrendChart data={trend} currency={currency} />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
