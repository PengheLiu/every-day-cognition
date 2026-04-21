import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce .next/standalone/ — a self-contained server bundle that can run
  // without the full node_modules tree. Dockerfile copies only what's needed.
  output: "standalone",

  // better-sqlite3 is a native module; keep it as an external dependency so
  // Next's trace-based bundler doesn't try to webpack it.
  serverExternalPackages: ["better-sqlite3"],

  async headers() {
    return [
      {
        // Service worker must not be cached by intermediaries — users need
        // the latest SW to get new app versions without stuck installs.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
