import type { NextConfig } from "next";

import { assertMockAllowed } from "./lib/mock-mode";

// Fails the build if TAKEOVER_MOCK=1 on a Vercel production deploy.
assertMockAllowed();

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The share-image routes read the bundled Anton font (lib/og.tsx); local PGlite databases read
  // the migrations at startup (lib/db/index.ts).
  outputFileTracingIncludes: { "/**/*": ["./lib/fonts/**", "./drizzle/**"] },
  // PGlite loads its WebAssembly and data files from its own package directory.
  serverExternalPackages: ["@electric-sql/pglite"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
