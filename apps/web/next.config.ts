// apps/web/next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              // 👇 add BOTH https and wss for Yellow, plus your API
              "connect-src 'self' http://localhost:4000 https://clearnet.yellow.com wss://clearnet.yellow.com",
              "frame-src 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};
export default nextConfig;
