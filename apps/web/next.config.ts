// apps/web/next.config.ts
import type { NextConfig } from "next";

const IMG_HOST = "https://hebbkx1anhila5yf.public.blob.vercel-storage.com";
const API_HOST = "http://localhost:4000"; // change via env if needed

const nextConfig: NextConfig = {
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // ✅ allow same-origin + data/blob + your Vercel Blob image host
      `img-src 'self' data: blob: ${IMG_HOST}`,
      "font-src 'self' data:",
      // 👇 Yellow (https + wss) + your API
      `connect-src 'self' ${API_HOST} https://clearnet.yellow.com wss://clearnet.yellow.com`,
      "frame-src 'self'",
      // (optional but recommended)
      "base-uri 'self'",
      "frame-ancestors 'self'",
      // allow Next to transpile the server package from the monorepo
      "transpilePackages", ['@blinkpay/server'],
  // (older Next versions) sometimes also need:
       "experimental", { externalDir: true },
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
