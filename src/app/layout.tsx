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
      </head>
      <body>
        {gaId && <GoogleAnalytics gaId={gaId} />}
        <SessionProviderWrapper>{children}</SessionProviderWrapper>
      </body>
    </html>
  );
}
