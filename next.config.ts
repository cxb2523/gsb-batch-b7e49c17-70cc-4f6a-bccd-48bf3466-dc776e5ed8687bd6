import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  logging: { incomingRequests: false },
  // Lets tests run a second isolated dev server alongside the main one.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The degradation test server opts out of the Data Cache so its GitHub
  // stub can change behaviour between requests.
  cacheHandler: process.env.NEXT_NO_DATA_CACHE
    ? path.resolve("tests/no-cache-handler.mjs")
    : undefined,
};

export default nextConfig;
