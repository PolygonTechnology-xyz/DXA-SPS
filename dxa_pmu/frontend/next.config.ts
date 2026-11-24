import type { NextConfig } from "next";
import path from "path";

// The browser only talks to this app; /api/* is forwarded to the FastAPI backend.
// BACKEND_URL is read at build time (it is baked into the routes manifest).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  // Report creation waits on Claude and can exceed the proxy's default 30s, which drops the connection.
  experimental: { proxyTimeout: 180_000 },
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
