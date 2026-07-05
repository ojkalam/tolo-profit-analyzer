import { flatRoutes } from "@react-router/fs-routes";

// Co-located *.test.ts files under app/routes are Vitest specs, not routes —
// exclude them so the client build never pulls server code through a "route".
export default flatRoutes({
  ignoredRouteFiles: ["**/*.test.{ts,tsx}"],
});
