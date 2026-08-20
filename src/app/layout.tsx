import type { Metadata, Viewport } from "next";
import "./globals.css";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import GoogleAnalytics from "@/components/GoogleAnalytics";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org";
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
    // The real description, not the title repeated: this is the blurb a
    // shared homepage link shows under its headline.
    description: "True stories for the time you have: reported narratives, essays, micro-memoirs and craft talks.",
    url: siteUrl,
    images: [{ url: "/open-graph.png", width: 1200, height: 630, alt: "Gangrey Magazine" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gangrey | A Literary Magazine",
    description: "True stories for the time you have: reported narratives, essays, micro-memoirs and craft talks.",
    images: ["/open-graph.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  // cover → env(safe-area-inset-*) is populated in full-bleed contexts (the
  // Imago iOS shell); sticky admin headers stretch by --safe-top there.
  // Everywhere else the insets are 0 and nothing changes.
  viewportFit: "cover",
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
        {/* Site-level identity, as one @graph so the two entities reference
            each other by @id instead of floating separately. Per-article
            markup points its publisher at the same #organization id, so every
            page describes one brand rather than repeating an anonymous copy.

            Organization is what a knowledge panel is built from. The logo
            matters because without it search engines guess off page content,
            and that guess was landing on the header wordmark: small, gray and
            illegible at thumbnail size. logo-square.png is the black-bubble G,
            solid corner to corner, legible at any size.

            WebSite carries the SearchAction behind the sitelinks search box.
            Its target is a real, working URL: /archive reads ?q= and renders
            results for it. Declaring a search endpoint that did not actually
            respond would simply be ignored. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${siteUrl}/#organization`,
              name: "Gangrey",
              url: siteUrl,
              description: "Gangrey is a literary magazine that publishes true stories for the time you have, from reported narratives and essays to micro-memoirs and craft talks.",
              logo: {
                "@type": "ImageObject",
                "@id": `${siteUrl}/#logo`,
                url: `${siteUrl}/logo-square.png`,
                width: 512,
                height: 512,
                caption: "Gangrey",
              },
              image: { "@id": `${siteUrl}/#logo` },
              // Only profiles the magazine actually runs — this is a brand
              // disambiguation signal, so a wrong entry is worse than none.
              sameAs: ["https://www.instagram.com/gangreymag/"],
            },
            {
              "@type": "WebSite",
              "@id": `${siteUrl}/#website`,
              url: siteUrl,
              name: "Gangrey",
              description: "A literary magazine publishing true stories for the time you have.",
              inLanguage: "en-US",
              publisher: { "@id": `${siteUrl}/#organization` },
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: `${siteUrl}/archive?q={search_term_string}`,
                },
                "query-input": "required name=search_term_string",
              },
            },
          ],
        }) }} />
        {gaId && <GoogleAnalytics gaId={gaId} />}
        <SessionProviderWrapper>{children}</SessionProviderWrapper>
      </body>
    </html>
  );
}
