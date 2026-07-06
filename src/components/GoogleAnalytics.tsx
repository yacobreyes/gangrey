"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

// Loads Google Analytics 4 only on public pages. The admin/CMS (/admin/*) is
// excluded entirely — no gtag script, no pageviews — so editorial work isn't
// counted as traffic.
export default function GoogleAnalytics({ gaId }: { gaId: string }) {
  const pathname = usePathname();
  if (!gaId || pathname?.startsWith("/admin")) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaId}');`}
      </Script>
    </>
  );
}
