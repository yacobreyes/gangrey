import type { Metadata, Viewport } from "next";
import "./globals.css";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import GoogleAnalytics from "@/components/GoogleAnalytics";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org";
// Google Analytics 4. Set NEXT_PUBLIC_GA_ID (e.g. G-XXXXXXXXXX) to enable;
// left empty, no analytics scripts load at all.
const gaId = process.env.NEXT_PUBLIC_GA_ID;

export const metadata: Metadata = {
  title: "Gangrey | A Literary Magazine",
  description: "Gangrey is a literary magazine that publishes true stories for the time you have, from reported narratives and essays to micro-memoirs and craft talks.",
  metadataBase: new URL(siteUrl),
  // One favicon everywhere: the black circle-bubble "G". Every size (browser
  // tab 16/32, Google 48/96/192, apple-touch 180) is downscaled from the same
  // bubble master so the mark is identical at every scale.
  icons: {
    icon: [
      // The root .ico is the URL every crawler (Google especially) probes
      // first, by convention, before reading the sized PNGs below. It bundles
      // the bubble at 16/32/48.
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-circle-48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-circle-96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon-circle-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  alternates: {
    types: { "application/rss+xml": `${siteUrl}/feed.xml` },
  },
  openGraph: {
    siteName: "Gangrey",
    title: "Gangrey | A Literary Magazine",
    description: "Gangrey | A Literary Magazine",
    url: siteUrl,
    images: [{ url: "/open-graph.png", width: 1200, height: 630, alt: "Gangrey Magazine" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gangrey | A Literary Magazine",
    description: "Gangrey | A Literary Magazine",
    images: ["/open-graph.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://use.typekit.net" crossOrigin="" />
        <link rel="stylesheet" href="https://use.typekit.net/umi3ufr.css" />
        {/* Preload the masthead wordmark so it's painted with the header instead
            of popping in a beat later (the "Gangrey blink" on refresh). */}
        <link rel="preload" as="image" href="/Wordmark.png?v=7" fetchPriority="high" />
      </head>
      <body>
        {gaId && <GoogleAnalytics gaId={gaId} />}
        <SessionProviderWrapper>{children}</SessionProviderWrapper>
      </body>
    </html>
  );
}
