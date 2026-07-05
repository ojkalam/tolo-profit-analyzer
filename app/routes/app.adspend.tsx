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
  toloAddAdSpend,
  toloDeleteAdSpend,
  toloListAdSpend,
} from "../services/costs/tolo-adspend.server";
import {
  TOLO_AD_CHANNELS,
  type ToloAdChannel,
} from "../services/costs/tolo-adspend-shared";
import { toloDayKey } from "../services/tolo-dates";
import { toloDecimalToCents, toloFormatCents } from "../services/profit/tolo-format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const entries = await toloListAdSpend(shop.id);
  return {
    entries,
    currency: shop.currency,
    today: toloDayKey(new Date(), shop.ianaTimezone),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const body = await request.json();

  switch (body.intent) {
    case "add": {
      const amountCents = toloDecimalToCents(body.amount);
      if (amountCents <= 0) {
        return { ok: false, message: "Enter an amount greater than zero" };
      }
      await toloAddAdSpend(shop.shopDomain, shop.id, {
        channel: body.channel as ToloAdChannel,
        date: body.date,
        endDate: body.endDate || undefined,
        amountCents,
        note: body.note || undefined,
      });
      return { ok: true, message: "Ad spend recorded" };
    }
    case "delete": {
      await toloDeleteAdSpend(shop.shopDomain, body.id);
      return { ok: true, message: "Entry deleted" };
    }
    default:
      return { ok: false, message: "Unknown action" };
  }
};

export default function ToloAdSpendPage() {
  const { entries, currency, today } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  const [channel, setChannel] = useState<ToloAdChannel>("meta");
  const [date, setDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const add = () => {
    fetcher.submit(
      { intent: "add", channel, date, endDate, amount, note },
      { method: "post", encType: "application/json" },
    );
    setAmount("");
    setNote("");
  };

  return (
    <s-page heading="Ad spend">
      <s-section heading="Record spend">
        <s-paragraph>
          Enter spend per channel. A date range or a monthly total is split
          evenly across its days, then allocated to products by that day&apos;s
          revenue share.
        </s-paragraph>
        {fetcher.data?.message && (
          <s-banner tone={fetcher.data.ok ? "success" : "critical"}>
            <s-paragraph>{fetcher.data.message}</s-paragraph>
          </s-banner>
        )}
        <s-stack direction="block" gap="base">
          <s-select
            label="Channel"
            value={channel}
            onChange={(e) =>
              setChannel(e.currentTarget.value as ToloAdChannel)
            }
          >
            {TOLO_AD_CHANNELS.map((c) => (
              <s-option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </s-option>
            ))}
          </s-select>
          <s-stack direction="inline" gap="base">
            <s-date-field
              label="From date"
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
            />
            <s-date-field
              label="To date (optional — for a range)"
              value={endDate}
              onChange={(e) => setEndDate(e.currentTarget.value)}
            />
          </s-stack>
          <s-money-field
            label="Amount (total for the period)"
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            placeholder="250.00"
          />
          <s-text-field
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
          <s-button
            variant="primary"
            onClick={add}
            {...(busy ? { disabled: true } : {})}
          >
            Add spend
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading={`History (${entries.length})`}>
        {entries.length === 0 ? (
          <s-paragraph>No ad spend recorded yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Date</s-table-header>
              <s-table-header>Channel</s-table-header>
              <s-table-header>Amount</s-table-header>
              <s-table-header>Note</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {entries.map((entry) => (
                <s-table-row key={entry.id}>
                  <s-table-cell>{entry.date}</s-table-cell>
                  <s-table-cell>
                    <s-badge>{entry.channel}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {toloFormatCents(entry.amountCents, currency)}
                  </s-table-cell>
                  <s-table-cell>{entry.note ?? "—"}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() =>
                        fetcher.submit(
                          { intent: "delete", id: entry.id },
                          { method: "post", encType: "application/json" },
                        )
                      }
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
