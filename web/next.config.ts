import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce .next/standalone/ — a self-contained server bundle that can run
  // without the full node_modules tree. Dockerfile copies only what's needed.
  output: "standalone",

  // node:sqlite is a built-in — explicitly mark as external so Next's
  // bundler doesn't try to resolve/inline it
  serverExternalPackages: ["node:sqlite"],

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
