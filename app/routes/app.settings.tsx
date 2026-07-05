import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { toloEnsureShop } from "../services/tolo-shops.server";
import { toloEnqueue } from "../jobs/tolo-queue.server";
import {
  TOLO_PLANS,
  toloCanExportCsv,
  toloOrderUsage,
} from "../services/billing/tolo-billing.server";
import { toloDecimalToCents } from "../services/profit/tolo-format";
import { toloSubmitJson } from "../utils/tolo-submit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await toloEnsureShop(session.shop);
  const usage = await toloOrderUsage(shop);
  return {
    shop: {
      plan: shop.plan,
      currency: shop.currency,
      feeRatePct: (shop.feeRateBps / 100).toString(),
      feeFixedCents: shop.feeFixedCents,
      weeklyEmail: shop.weeklyEmail,
      notificationEmail: shop.notificationEmail ?? "",
      trialEndsAt: shop.trialEndsAt?.toISOString().slice(0, 10) ?? null,
    },
    usage,
    plans: TOLO_PLANS,
    canExport: toloCanExportCsv(shop.plan),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = await toloEnsureShop(session.shop);
  const body = await request.json();

  switch (body.intent) {
    case "subscribe": {
      // Redirects to Shopify's managed confirmation page (throws a redirect).
      const returnUrl = `https://${process.env.SHOPIFY_APP_URL?.replace(/^https?:\/\//, "")}/app/settings`;
      await billing.request({
        plan: body.plan,
        isTest: process.env.NODE_ENV !== "production",
        returnUrl,
      });
      return { ok: true, message: "" };
    }
    case "save-fees": {
      await prisma.toloShop.update({
        where: { id: shop.id },
        data: {
          feeRateBps: Math.round(Number(body.feeRatePct) * 100),
          feeFixedCents: toloDecimalToCents(body.feeFixed),
        },
      });
      await toloEnqueue(
        "tolo:rollup",
        { shopDomain: shop.shopDomain },
        { dedupeId: `tolo:rollup:${shop.shopDomain}:fees`, delayMs: 3_000 },
      );
      return { ok: true, message: "Fees saved — profit recomputing" };
    }
    case "save-prefs": {
      await prisma.toloShop.update({
        where: { id: shop.id },
        data: {
          weeklyEmail: !!body.weeklyEmail,
          notificationEmail: body.notificationEmail || null,
        },
      });
      return { ok: true, message: "Preferences saved" };
    }
    default:
      return { ok: false, message: "Unknown action" };
  }
};

export default function ToloSettingsPage() {
  const { shop, usage, plans, canExport } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [feeRatePct, setFeeRatePct] = useState(shop.feeRatePct);
  const [feeFixed, setFeeFixed] = useState((shop.feeFixedCents / 100).toFixed(2));
  const [weeklyEmail, setWeeklyEmail] = useState(shop.weeklyEmail);
  const [email, setEmail] = useState(shop.notificationEmail);
  const [exportLevel, setExportLevel] = useState("orders");
  const [exportRange, setExportRange] = useState("30d");

  return (
    <s-page heading="Settings">
      {fetcher.data?.message ? (
        <s-banner tone="success">
          <s-paragraph>{fetcher.data.message}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Plan & billing">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Current plan: <s-text type="strong">{shop.plan}</s-text>
            {shop.trialEndsAt ? ` · trial ends ${shop.trialEndsAt}` : ""}
          </s-paragraph>
          {usage.limit != null && (
            <s-banner tone={usage.over ? "warning" : "info"}>
              <s-paragraph>
                {usage.used} / {usage.limit} orders this month.
                {usage.over
                  ? " You're over your plan limit — data still syncs, but upgrade to stay within terms."
                  : ""}
              </s-paragraph>
            </s-banner>
          )}
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            {plans.map((plan) => (
              <s-box
                key={plan.key}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small-500">
                  <s-heading>{plan.billingName}</s-heading>
                  <s-text type="strong">${plan.priceUsd}/mo</s-text>
                  <s-unordered-list>
                    {plan.features.map((f) => (
                      <s-list-item key={f}>{f}</s-list-item>
                    ))}
                  </s-unordered-list>
                  <s-button
                    variant={shop.plan === plan.key ? "tertiary" : "primary"}
                    {...(shop.plan === plan.key ? { disabled: true } : {})}
                    onClick={() =>
                      toloSubmitJson(fetcher.submit, {
                        intent: "subscribe",
                        plan: plan.billingName,
                      })
                    }
                  >
                    {shop.plan === plan.key ? "Current plan" : `Choose ${plan.billingName}`}
                  </s-button>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Transaction fees">
        <s-paragraph>
          Estimated payment-gateway fee applied to each order. Defaults to
          Shopify Payments&apos; standard rate.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-number-field
            label="Rate (%)"
            value={feeRatePct}
            onChange={(e) => setFeeRatePct(e.currentTarget.value)}
          />
          <s-money-field
            label="Fixed fee per order"
            value={feeFixed}
            onChange={(e) => setFeeFixed(e.currentTarget.value)}
          />
          <s-button
            variant="primary"
            onClick={() =>
              toloSubmitJson(fetcher.submit, {
                intent: "save-fees",
                feeRatePct: Number(feeRatePct) || 0,
                feeFixed,
              })
            }
          >
            Save fees
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Notifications">
        <s-stack direction="block" gap="base">
          <s-email-field
            label="Notification email (alerts + weekly report)"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <s-switch
            label="Send the weekly profit email (Mondays)"
            {...(weeklyEmail ? { checked: true } : {})}
            onChange={(e) => setWeeklyEmail(e.currentTarget.checked)}
          />
          <s-button
            variant="primary"
            onClick={() =>
              toloSubmitJson(fetcher.submit, {
                intent: "save-prefs",
                weeklyEmail,
                notificationEmail: email,
              })
            }
          >
            Save preferences
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Export">
        {canExport ? (
          <s-stack direction="block" gap="base">
            <s-select
              label="Level"
              value={exportLevel}
              onChange={(e) => setExportLevel(e.currentTarget.value)}
            >
              <s-option value="orders">Orders</s-option>
              <s-option value="products">Products</s-option>
              <s-option value="monthly">Monthly (accountant pack)</s-option>
            </s-select>
            <s-select
              label="Range"
              value={exportRange}
              onChange={(e) => setExportRange(e.currentTarget.value)}
            >
              <s-option value="today">Today</s-option>
              <s-option value="7d">Last 7 days</s-option>
              <s-option value="30d">Last 30 days</s-option>
            </s-select>
            <s-link
              href={`/app/export.csv?level=${exportLevel}&range=${exportRange}`}
              download="tolo-profit.csv"
            >
              Download CSV
            </s-link>
          </s-stack>
        ) : (
          <s-paragraph>
            CSV export is a Pro feature.{" "}
            <s-text type="strong">Upgrade to Pro</s-text> to export order- and
            product-level profit for your accountant.
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
