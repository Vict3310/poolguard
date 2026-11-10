import type { NextConfig } from "next";

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:4100";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow both loopback spellings in local development. Without this, Next.js
  // blocks its dev resources when the browser uses 127.0.0.1 and hydration/HMR
  // can stall in a way that looks like an application bug.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
