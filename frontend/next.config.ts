import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  productionBrowserSourceMaps: process.env.FRONTEND_DEBUG_SOURCEMAPS === "1",
  // Keep dev origins domain-based so production no longer depends on the retired VPS IP.
  allowedDevOrigins: ["localhost", "127.0.0.1", "clause.id", "www.clause.id"],
  turbopack: {},
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
