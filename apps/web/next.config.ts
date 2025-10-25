/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              [
                "default-src 'self'",
                "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                // 👇 allow your API + RPCs + any ws you need
                "connect-src 'self' http://localhost:4000 https://eth-sepolia.g.alchemy.com wss://nitrolite-test.yellow.org",
                "font-src 'self' data:",
                "frame-src 'self'",
              ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
