import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Lets `next dev` serve its scripts through a Cloudflare quick tunnel, for
  // testing on a phone. Dev-only: production builds ignore it.
  allowedDevOrigins: ["*.trycloudflare.com"],
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
