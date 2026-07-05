import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { toloAppContext } from "../services/tolo-app-context.server";
import { toloCostCompleteness } from "../services/costs/tolo-costs.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await toloAppContext(request);
  const completeness = await toloCostCompleteness(shop.id, shop.ianaTimezone);
  return {
    importStatus: shop.importStatus,
    importProgress: shop.importProgress,
    completeness,
  };
};

function StepIcon({ done }: { done: boolean }) {
  return (
    <s-badge tone={done ? "success" : "neutral"}>
      {done ? "Done" : "To do"}
    </s-badge>
  );
}

export default function ToloOnboardingPage() {
  const { importStatus, importProgress, completeness } =
    useLoaderData<typeof loader>();

  const importDone = importStatus === "complete";
  const costsDone = completeness.revenuePct >= 80;

  return (
    <s-page heading="Get set up with Tolo">
      <s-section heading="Three steps to real profit">
        <s-stack direction="block" gap="large">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-500">
              <s-stack direction="inline" gap="small-300">
                <StepIcon done={true} />
                <s-heading>1. App installed</s-heading>
              </s-stack>
              <s-paragraph>
                Tolo is connected to your store and listening for new orders and
                refunds.
              </s-paragraph>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-500">
              <s-stack direction="inline" gap="small-300">
                <StepIcon done={importDone} />
                <s-heading>2. Importing your history</s-heading>
              </s-stack>
              {importDone ? (
                <s-paragraph>Order history imported. ✅</s-paragraph>
              ) : (
                <s-paragraph>
                  Backfilling your orders… {importProgress}% complete. This runs
                  in the background — you can keep setting up.
                </s-paragraph>
              )}
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-500">
              <s-stack direction="inline" gap="small-300">
                <StepIcon done={costsDone} />
                <s-heading>3. Set your product costs</s-heading>
              </s-stack>
              <s-paragraph>
                Costs cover {completeness.revenuePct}% of recent revenue. Import
                from Shopify or add them in the cost editor — accuracy is the
                whole product.
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button variant="primary" href="/app/costs">
                  Set product costs
                </s-button>
                {costsDone && (
                  <s-button href="/app">See your profit dashboard</s-button>
                )}
              </s-stack>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
