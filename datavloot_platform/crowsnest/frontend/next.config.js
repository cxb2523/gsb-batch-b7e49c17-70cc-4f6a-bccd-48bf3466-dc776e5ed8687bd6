/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // In dev mode, proxy /api to the FastAPI backend on :8080
  ...(process.env.NODE_ENV === 'development' && {
    output: undefined,
    async rewrites() {
      return [
        {
          source: '/api/:path*',
          destination: 'http://localhost:8080/api/:path*',
        },
      ];
    },
  }),
};

module.exports = nextConfig;
