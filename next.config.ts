
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Next.js output tracing scoped to this snapshot project.
  outputFileTracingRoot: process.cwd(),

  serverExternalPackages: ["@prisma/client", "prisma"],

  outputFileTracingIncludes: {
    "/*": ["./lib/generated/prisma/**/*"],
    "/api/*": ["./lib/generated/prisma/**/*"],
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*",
        port: "",
        pathname: "/**",
      },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
