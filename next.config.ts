import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // Version-skew protection. deploy.sh bakes the git short SHA into this at
  // build time (via the NEXT_DEPLOYMENT_ID build arg). Next stamps it on every
  // navigation RSC response; when a browser tab left open across a deploy
  // requests a page from the new build, the id no longer matches and Next
  // forces a full-page reload instead of silently failing the client-side
  // navigation (the "clicking a link does nothing after a deploy" bug).
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
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
    ];
  },
  // Keep the secret page out of search results.
  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      { source: "/recording", headers: noindex },
      { source: "/recording.html", headers: noindex },
      // Build assets and the feed are not pages, but Google crawls them (it
      // needs the JS to render) and then files them under "Crawled - currently
      // not indexed", which makes an index-coverage validation fail forever on
      // URLs that were never going to be search results.
      //
      // noindex (NOT a robots.txt Disallow) is the right tool: blocking these
      // would stop Googlebot rendering the site and actively hurt ranking.
      // This only says "don't list this as a result", not "don't fetch it".
      //
      // It matters more since deploymentId: every deploy re-stamps asset URLs
      // with a new ?dpl=, so each release would otherwise mint a fresh batch of
      // crawlable non-page URLs.
      { source: "/_next/static/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/feed.xml", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
  // Canonical host is www.gangrey.org — 301 any bare gangrey.org request to
  // it so Google only ever indexes one hostname (avoids the www/non-www
  // "duplicate" split in Search Console). The middleware enforces the same
  // rule against x-forwarded-host, which is what actually fires behind Caddy.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "gangrey.org" }],
        destination: "https://www.gangrey.org/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
