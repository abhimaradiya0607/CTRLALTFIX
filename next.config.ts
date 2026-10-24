
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Next.js output tracing scoped to this snapshot project.
  outputFileTracingRoot: process.cwd(),

  serverExternalPackages: ["@prisma/client", "prisma"],

  outputFileTracingIncludes: {
    "/api/template/[id]": ["./starters/**/*"],
    "/api/*": ["./starters/**/*"],
    "/*": [
      "./node_modules/.prisma/client/**/*",
      "./node_modules/@prisma/client/**/*",
      "./starters/**/*",
    ],
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
