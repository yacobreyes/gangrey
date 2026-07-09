import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // STANDALONE=1 builds a self-contained Node server (for Docker/VPS installs
  // with the sqlite backend). Unset, the build stays Vercel-serverless.
  ...(process.env.STANDALONE ? { output: "standalone" as const } : {}),
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
      // Secret standalone page: serve the self-contained HTML bundle verbatim
      // at /recording with no site chrome (no masthead/footer — it's a static
      // file in /public, not a Next page).
      { source: "/recording", destination: "/recording.html" },
    ];
  },
  // Keep the secret page out of search results.
  async headers() {
    return [
      {
        source: "/recording:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
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
