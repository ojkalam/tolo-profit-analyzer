import { useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { toloAppContext } from "../services/tolo-app-context.server";
import {
  toloApplyCsvCosts,
  toloCostCompleteness,
  toloListVariantCosts,
  toloParseCostCsv,
  toloSetCost,
} from "../services/costs/tolo-costs.server";
import { toloEnqueue } from "../jobs/tolo-queue.server";
import { toloDecimalToCents, toloFormatCents } from "../services/profit/tolo-format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const [rows, completeness] = await Promise.all([
    toloListVariantCosts(shop.id),
    toloCostCompleteness(shop.id, shop.ianaTimezone),
  ]);
  return { rows, completeness, currency: shop.currency };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const body = await request.json();

  switch (body.intent) {
    case "save-costs": {
      const edits = body.edits as Array<{
        variantId: string;
        productId: string;
        cost: string;
      }>;
      let saved = 0;
      for (const edit of edits) {
        const costCents = toloDecimalToCents(edit.cost);
        if (costCents <= 0) continue;
        await toloSetCost(shop.shopDomain, shop.id, {
          variantId: edit.variantId,
          productId: edit.productId,
          costCents,
          source: "manual",
        });
        saved += 1;
      }
      return { ok: true, message: `Saved ${saved} cost${saved === 1 ? "" : "s"}` };
    }
    case "import-shopify": {
      await toloEnqueue("tolo:catalog-sync", { shopDomain: shop.shopDomain });
      return {
        ok: true,
        message: "Importing costs from Shopify — refresh in a moment",
      };
    }
    case "import-csv": {
      const { rows, errors } = toloParseCostCsv(String(body.csv ?? ""));
      if (errors.length > 0) {
        return { ok: false, message: errors.join("; ") };
      }
      const { applied, unmatched } = await toloApplyCsvCosts(
        shop.shopDomain,
        shop.id,
        rows,
      );
      return {
        ok: true,
        message: `Applied ${applied} cost${applied === 1 ? "" : "s"}${
          unmatched.length ? `; ${unmatched.length} unmatched (by SKU/ID)` : ""
        }`,
      };
    }
    default:
      return { ok: false, message: "Unknown action" };
  }
};

export default function ToloCostsPage() {
  const { rows, completeness, currency } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [csv, setCsv] = useState("");

  const changed = useMemo(
    () => Object.entries(edits).filter(([, v]) => v.trim() !== ""),
    [edits],
  );
  const busy = fetcher.state !== "idle";

  const saveCosts = () => {
    const rowById = new Map(rows.map((r) => [r.variantId, r]));
    const payload = changed
      .map(([variantId, cost]) => {
        const row = rowById.get(variantId);
        return row ? { variantId, productId: row.productId, cost } : null;
      })
      .filter(Boolean);
    fetcher.submit(
      { intent: "save-costs", edits: payload },
      { method: "post", encType: "application/json" },
    );
    setEdits({});
  };

  return (
    <s-page heading="Product costs (COGS)">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={saveCosts}
        {...(changed.length === 0 || busy ? { disabled: true } : {})}
      >
        {`Save ${changed.length || ""} change${changed.length === 1 ? "" : "s"}`}
      </s-button>

      <s-section heading="Cost completeness">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            You&apos;ve set costs for <s-text type="strong">{completeness.catalogPct}%</s-text>{" "}
            of your catalog ({completeness.variantsWithCost}/
            {completeness.variantsTotal} variants), covering{" "}
            <s-text type="strong">{completeness.revenuePct}%</s-text> of the
            last 30 days&apos; revenue.
          </s-paragraph>
          {completeness.revenuePct < 90 && (
            <s-banner tone="warning" heading="Accuracy needs your costs">
              <s-paragraph>
                Profit numbers are estimates until costs cover your revenue. Set
                costs for your top sellers first.
              </s-paragraph>
            </s-banner>
          )}
          {fetcher.data?.message && (
            <s-banner tone={fetcher.data.ok ? "success" : "critical"}>
              <s-paragraph>{fetcher.data.message}</s-paragraph>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Import">
        <s-stack direction="inline" gap="base">
          <s-button
            onClick={() =>
              fetcher.submit(
                { intent: "import-shopify" },
                { method: "post", encType: "application/json" },
              )
            }
            {...(busy ? { disabled: true } : {})}
          >
            Import costs from Shopify
          </s-button>
        </s-stack>
        <s-text-area
          label="Or paste CSV (columns: sku or variant_id, cost)"
          value={csv}
          onChange={(e) => setCsv(e.currentTarget.value)}
          placeholder={"sku,cost\nRIBEYE-12,8.50"}
        />
        <s-button
          onClick={() =>
            fetcher.submit(
              { intent: "import-csv", csv },
              { method: "post", encType: "application/json" },
            )
          }
          {...(busy || csv.trim() === "" ? { disabled: true } : {})}
        >
          Apply CSV costs
        </s-button>
      </s-section>

      <s-section heading={`Variants (${rows.length})`}>
        {rows.length === 0 ? (
          <s-paragraph>
            No products synced yet. They&apos;ll appear here once the catalog
            import finishes.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Variant</s-table-header>
              <s-table-header>SKU</s-table-header>
              <s-table-header>Price</s-table-header>
              <s-table-header>Current cost</s-table-header>
              <s-table-header>New cost</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((row) => (
                <s-table-row key={row.variantId}>
                  <s-table-cell>{row.productTitle}</s-table-cell>
                  <s-table-cell>{row.variantTitle ?? "—"}</s-table-cell>
                  <s-table-cell>{row.sku ?? "—"}</s-table-cell>
                  <s-table-cell>
                    {toloFormatCents(row.priceCents, currency)}
                  </s-table-cell>
                  <s-table-cell>
                    {row.currentCostCents != null ? (
                      <s-stack direction="inline" gap="small-500">
                        <s-text>
                          {toloFormatCents(row.currentCostCents, currency)}
                        </s-text>
                        {row.source && (
                          <s-badge
                            tone={row.source === "manual" ? "info" : "neutral"}
                          >
                            {row.source === "shopify_import"
                              ? "Shopify"
                              : row.source}
                          </s-badge>
                        )}
                      </s-stack>
                    ) : (
                      <s-badge tone="warning">Not set</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-money-field
                      label=""
                      labelAccessibilityVisibility="exclusive"
                      value={edits[row.variantId] ?? ""}
                      placeholder="0.00"
                      onChange={(e) =>
                        setEdits((prev) => ({
                          ...prev,
                          [row.variantId]: e.currentTarget.value,
                        }))
                      }
                    />
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
