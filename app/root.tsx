import { useEffect } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import * as Sentry from "@sentry/react";

export const loader = () => {
  return { toloSentryDsn: process.env.SENTRY_DSN ?? "" };
};

export default function App() {
  const { toloSentryDsn } = useLoaderData<typeof loader>();

  useEffect(() => {
    if (toloSentryDsn) {
      Sentry.init({ dsn: toloSentryDsn, tracesSampleRate: 0.1 });
    }
  }, [toloSentryDsn]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
