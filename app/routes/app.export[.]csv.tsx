import type { LoaderFunctionArgs } from "react-router";
import { toloAppContext } from "../services/tolo-app-context.server";
import {
  toloResolveRange,
  type ToloRangeKey,
} from "../services/profit/tolo-profit-queries.server";
import {
  toloMonthlyCsv,
  toloOrderCsv,
  toloProductCsv,
} from "../services/reports/tolo-csv.server";
import { toloCanExportCsv } from "../services/billing/tolo-billing.server";

// Resource route (no default export): returns a CSV file download. Pro-gated.
// /app/export.csv?level=orders|products|monthly&range=30d
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  if (!toloCanExportCsv(shop.plan)) {
    return new Response("CSV export is a Pro feature.", { status: 402 });
  }

  const url = new URL(request.url);
  const levelParam = url.searchParams.get("level");
  const level =
    levelParam === "products" || levelParam === "monthly"
      ? levelParam
      : "orders";
  const rangeKey = (url.searchParams.get("range") as ToloRangeKey) ?? "30d";
  const validKey: ToloRangeKey = ["today", "7d", "30d"].includes(rangeKey)
    ? rangeKey
    : "30d";
  const range = toloResolveRange(shop, validKey);

  const csv =
    level === "products"
      ? await toloProductCsv(shop.id, range, shop.currency)
      : level === "monthly"
        ? await toloMonthlyCsv(shop.id, range, shop.currency)
        : await toloOrderCsv(shop.id, range, shop.currency);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tolo-${level}-${range.from}_${range.to}.csv"`,
    },
  });
};
