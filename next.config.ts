import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sanity", "@sanity/vision"],
  // Featured/body images upload through the `uploadImage` Server Action. The
  // default Server Action body limit is 1MB, which rejects most photos and
  // surfaces as a generic "Server Components render" error in production. Raise
  // it so multi-megabyte images upload successfully.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  async rewrites() {
    return [
      { source: "/narratives", destination: "/?tab=Narratives" },
      { source: "/micro-memoirs", destination: "/?tab=Micro-Memoirs" },
      { source: "/essays", destination: "/?tab=Essays" },
    ];
  },
  // Canonical host is the bare gangrey.org — 301 any www.gangrey.org request to
  // it so Google only ever indexes one hostname (avoids the www/non-www
  // "duplicate" split in Search Console).
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.gangrey.org" }],
        destination: "https://gangrey.org/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
