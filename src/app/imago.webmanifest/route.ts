import { NextResponse } from "next/server";

// Web app manifest for Imago only — linked from the Imago layout, not from the
// public magazine, so "add to home screen" installs the CMS rather than the
// reading site. Scoped to /admin/imago so navigating out of the CMS opens a
// normal browser tab.
//
// A manifest is also what lets iOS treat the home-screen app as a real web app,
// which is a precondition for web push there.
export function GET() {
  return NextResponse.json({
    name: "Imago",
    short_name: "Imago",
    description: "Gangrey's editorial desk.",
    start_url: "/admin/imago",
    scope: "/admin/imago",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f8fa",
    theme_color: "#490000",
    icons: [
      { src: "/favicon-circle-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/favicon-circle-96.png", sizes: "96x96", type: "image/png" },
    ],
  }, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
