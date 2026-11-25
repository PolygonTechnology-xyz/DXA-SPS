import type { NextConfig } from "next";
import path from "path";

// The browser only talks to this app; /api/* is forwarded to the FastAPI backend.
// BACKEND_URL is read at build time (it is baked into the routes manifest).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // Home is the New project screen. Temporary, so browsers do not cache it if Home gets its own page later.
  async redirects() {
    return [{ source: "/", destination: "/projects/new", permanent: false }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  // Report creation waits on Claude and can exceed the proxy's default 30s, which drops the connection.
  // Uploads of up to 25 MB pass through the proxy, which otherwise cuts bodies off at 10 MB. Set a little
  // higher than the backend's limit, so that the backend sees an oversized file as too large and rejects it.
  experimental: { proxyTimeout: 180_000, proxyClientMaxBodySize: "26mb" },
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
