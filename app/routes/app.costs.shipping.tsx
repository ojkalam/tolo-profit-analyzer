import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { toloAppContext } from "../services/tolo-app-context.server";
import {
  toloDeleteShippingRule,
  toloListShippingRules,
  toloPreviewShipping,
  toloSaveShippingRule,
} from "../services/costs/tolo-shipping.server";
import type { ToloShippingRuleKind } from "../services/profit/tolo-profit-engine";
import { toloDecimalToCents, toloFormatCents } from "../services/profit/tolo-format";
import { toloSubmitJson } from "../utils/tolo-submit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const rules = await toloListShippingRules(shop.id);
  return { rules, currency: shop.currency };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const body = await request.json();

  try {
    switch (body.intent) {
      case "save-rule": {
        await toloSaveShippingRule(shop.shopDomain, shop.id, {
          id: body.id || undefined,
          kind: body.kind,
          config: body.config,
          priority: Number(body.priority) || 0,
          active: body.active !== false,
        });
        return { ok: true, message: "Shipping rule saved" };
      }
      case "delete-rule": {
        await toloDeleteShippingRule(shop.shopDomain, body.id);
        return { ok: true, message: "Rule deleted" };
      }
      default:
        return { ok: false, message: "Unknown action" };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Save failed",
    };
  }
};

const KIND_LABELS: Record<ToloShippingRuleKind, string> = {
  flat_order: "Flat per order",
  per_item: "Per item",
  weight_band: "Weight band",
  zone: "Country zone",
};

function describeConfig(kind: string, config: unknown, currency: string): string {
  const c = config as Record<string, unknown>;
  switch (kind) {
    case "flat_order":
    case "per_item":
      return toloFormatCents(Number(c.amountCents) || 0, currency);
    case "weight_band":
      return `${((c.bands as unknown[]) ?? []).length} band(s)`;
    case "zone":
      return `${((c.zones as unknown[]) ?? []).length} zone(s)`;
    default:
      return "";
  }
}

export default function ToloShippingPage() {
  const { rules, currency } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  // New simple rule (flat / per-item) — the common case. Weight/zone rules use
  // the JSON config field for power users.
  const [kind, setKind] = useState<ToloShippingRuleKind>("flat_order");
  const [amount, setAmount] = useState("");
  const [priority, setPriority] = useState("0");
  const [advancedJson, setAdvancedJson] = useState("");

  // Preview
  const [items, setItems] = useState("1");
  const [weight, setWeight] = useState("500");
  const [country, setCountry] = useState("US");
  const preview = toloPreviewShipping(rules, {
    itemCount: Number(items) || 0,
    totalWeightGrams: Number(weight) || 0,
    countryCode: country || null,
  });

  const saveRule = () => {
    let config: unknown;
    if (kind === "flat_order" || kind === "per_item") {
      config = { amountCents: toloDecimalToCents(amount) };
    } else {
      try {
        config = JSON.parse(advancedJson || "{}");
      } catch {
        return;
      }
    }
    toloSubmitJson(fetcher.submit, {
      intent: "save-rule",
      kind,
      config,
      priority: Number(priority) || 0,
      active: true,
    });
    setAmount("");
    setAdvancedJson("");
  };

  const deleteRule = (id: string) =>
    toloSubmitJson(fetcher.submit, { intent: "delete-rule", id });

  return (
    <s-page heading="Shipping cost rules">
      <s-section heading="How shipping cost is resolved">
        <s-paragraph>
          Active rules are evaluated in priority order (lowest first). The first
          rule that produces a cost wins. Set rules that reflect what shipping
          actually costs you — not what you charge customers.
        </s-paragraph>
        {fetcher.data?.message && (
          <s-banner tone={fetcher.data.ok ? "success" : "critical"}>
            <s-paragraph>{fetcher.data.message}</s-paragraph>
          </s-banner>
        )}
      </s-section>

      <s-section heading="Add a rule">
        <s-stack direction="block" gap="base">
          <s-select
            label="Rule type"
            value={kind}
            onChange={(e) =>
              setKind(e.currentTarget.value as ToloShippingRuleKind)
            }
          >
            <s-option value="flat_order">Flat per order</s-option>
            <s-option value="per_item">Per item</s-option>
            <s-option value="weight_band">Weight band (advanced)</s-option>
            <s-option value="zone">Country zone (advanced)</s-option>
          </s-select>

          {(kind === "flat_order" || kind === "per_item") && (
            <s-money-field
              label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
              placeholder="5.00"
            />
          )}

          {(kind === "weight_band" || kind === "zone") && (
            <s-text-area
              label={
                kind === "weight_band"
                  ? 'Bands JSON, e.g. {"bands":[{"maxGrams":500,"amountCents":500},{"maxGrams":null,"amountCents":1200}]}'
                  : 'Zones JSON, e.g. {"zones":[{"countries":"US,CA","amountCents":600}],"defaultCents":1500}'
              }
              value={advancedJson}
              onChange={(e) => setAdvancedJson(e.currentTarget.value)}
              rows={4}
            />
          )}

          <s-number-field
            label="Priority (lower runs first)"
            value={priority}
            onChange={(e) => setPriority(e.currentTarget.value)}
          />

          <s-button
            variant="primary"
            onClick={saveRule}
            {...(busy ? { disabled: true } : {})}
          >
            Add rule
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading={`Rules (${rules.length})`}>
        {rules.length === 0 ? (
          <s-paragraph>
            No shipping rules yet — orders currently carry $0 shipping cost.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Priority</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Config</s-table-header>
              <s-table-header>Active</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rules.map((rule) => (
                <s-table-row key={rule.id}>
                  <s-table-cell>{rule.priority}</s-table-cell>
                  <s-table-cell>{KIND_LABELS[rule.kind]}</s-table-cell>
                  <s-table-cell>
                    {describeConfig(rule.kind, rule.config, currency)}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={rule.active ? "success" : "neutral"}>
                      {rule.active ? "Active" : "Off"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => deleteRule(rule.id)}
                    >
                      Delete
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Test an order" slot="aside">
        <s-stack direction="block" gap="base">
          <s-number-field
            label="Item count"
            value={items}
            onChange={(e) => setItems(e.currentTarget.value)}
          />
          <s-number-field
            label="Total weight (grams)"
            value={weight}
            onChange={(e) => setWeight(e.currentTarget.value)}
          />
          <s-text-field
            label="Destination country code"
            value={country}
            onChange={(e) => setCountry(e.currentTarget.value.toUpperCase())}
          />
          <s-paragraph>
            Resolved shipping cost:{" "}
            <s-text type="strong">
              {toloFormatCents(preview.costCents, currency)}
            </s-text>
            {preview.ruleId ? "" : " (no rule matched)"}
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
