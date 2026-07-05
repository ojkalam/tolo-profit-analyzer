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
  toloGetAlertRuleView,
  toloListAlerts,
  toloSetAlertStatus,
  toloUpdateAlertRule,
} from "../services/alerts/tolo-alert-queries.server";
import { toloAlertHeadline } from "../services/alerts/tolo-alert-format";
import { toloEnqueue } from "../jobs/tolo-queue.server";
import { toloCanUseAlerts } from "../services/billing/tolo-billing.server";
import { toloSubmitJson } from "../utils/tolo-submit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const [alerts, rule] = await Promise.all([
    toloListAlerts(shop.id),
    toloGetAlertRuleView(shop.id),
  ]);
  return {
    alerts,
    rule,
    entitled: toloCanUseAlerts(shop.plan),
    plan: shop.plan,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const body = await request.json();

  switch (body.intent) {
    case "save-rule": {
      await toloUpdateAlertRule(shop.id, {
        marginFloorBps: Math.round(Number(body.marginFloorPct) * 100),
        channelInApp: !!body.channelInApp,
        channelEmail: !!body.channelEmail,
        active: !!body.active,
      });
      return { ok: true, message: "Alert settings saved" };
    }
    case "set-status": {
      await toloSetAlertStatus(shop.id, body.id, body.status);
      return { ok: true, message: "" };
    }
    case "run-now": {
      await toloEnqueue("tolo:alert-scan", { shopDomain: shop.shopDomain });
      return { ok: true, message: "Checking margins now — refresh shortly" };
    }
    default:
      return { ok: false, message: "Unknown action" };
  }
};

const KIND_TONE: Record<string, "critical" | "warning" | "info"> = {
  negative: "critical",
  margin_drop: "warning",
  returns_spike: "warning",
  anomaly: "warning",
};

export default function ToloAlertsPage() {
  const { alerts, rule, entitled, plan } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [floorPct, setFloorPct] = useState(
    (rule.marginFloorBps / 100).toString(),
  );
  const [inApp, setInApp] = useState(rule.channelInApp);
  const [email, setEmail] = useState(rule.channelEmail);
  const [active, setActive] = useState(rule.active);

  const openAlerts = alerts.filter((a) => a.status !== "resolved");

  return (
    <s-page heading="Margin alerts">
      {!entitled && (
        <s-banner tone="info" heading="Alerts are a Growth feature">
          <s-paragraph>
            You&apos;re on the {plan} plan. Alerts run during your trial;
            upgrade to Growth to keep them.{" "}
            <s-link href="/app/settings">See plans →</s-link>
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="Alert settings">
        {fetcher.data?.message ? (
          <s-banner tone="success">
            <s-paragraph>{fetcher.data.message}</s-paragraph>
          </s-banner>
        ) : null}
        <s-stack direction="block" gap="base">
          <s-number-field
            label="Margin floor (%)"
            details="Flag products whose 7-day margin drops below this"
            value={floorPct}
            onChange={(e) => setFloorPct(e.currentTarget.value)}
          />
          <s-switch
            label="In-app alerts"
            {...(inApp ? { checked: true } : {})}
            onChange={(e) => setInApp(e.currentTarget.checked)}
          />
          <s-switch
            label="Email alerts"
            {...(email ? { checked: true } : {})}
            onChange={(e) => setEmail(e.currentTarget.checked)}
          />
          <s-switch
            label="Alerts active"
            {...(active ? { checked: true } : {})}
            onChange={(e) => setActive(e.currentTarget.checked)}
          />
          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              onClick={() =>
                toloSubmitJson(fetcher.submit, {
                  intent: "save-rule",
                  marginFloorPct: Number(floorPct) || 0,
                  channelInApp: inApp,
                  channelEmail: email,
                  active,
                })
              }
            >
              Save settings
            </s-button>
            <s-button
              onClick={() =>
                toloSubmitJson(fetcher.submit, { intent: "run-now" })
              }
            >
              Check now
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={`Alert feed (${openAlerts.length} open)`}>
        {openAlerts.length === 0 ? (
          <s-paragraph>
            No open alerts. Products below your margin floor will show up here.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {openAlerts.map((alert) => (
              <s-box
                key={alert.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small-500">
                  <s-stack direction="inline" gap="small-300">
                    <s-badge tone={KIND_TONE[alert.kind] ?? "warning"}>
                      {alert.kind.replace("_", " ")}
                    </s-badge>
                    <s-text type="strong">{alert.productTitle}</s-text>
                    {alert.status === "new" && <s-badge tone="info">New</s-badge>}
                  </s-stack>
                  <s-text>{toloAlertHeadline(alert)}</s-text>
                  <s-stack direction="inline" gap="small-300">
                    {alert.productId && (
                      <s-link
                        href={`/app/products/${encodeURIComponent(alert.productId)}`}
                      >
                        View product
                      </s-link>
                    )}
                    {alert.status === "new" && (
                      <s-button
                        variant="tertiary"
                        onClick={() =>
                          toloSubmitJson(fetcher.submit, {
                            intent: "set-status",
                            id: alert.id,
                            status: "seen",
                          })
                        }
                      >
                        Mark seen
                      </s-button>
                    )}
                    <s-button
                      variant="tertiary"
                      onClick={() =>
                        toloSubmitJson(fetcher.submit, {
                          intent: "set-status",
                          id: alert.id,
                          status: "resolved",
                        })
                      }
                    >
                      Resolve
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
