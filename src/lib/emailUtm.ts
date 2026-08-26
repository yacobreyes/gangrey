// Stamp utm_source onto every own-site link in an outgoing email's HTML, so
// clicks from mail clients attribute to the email instead of "Direct" in
// Analytics (mail apps never send a referrer). The trackers read utm_source
// off the landing URL and /api/track prefers it over the referrer.
const OWN_HOST = /(^|\.)gangrey\.org$/;

export function tagEmailLinks(html: string, source: string): string {
  const selfHost = (() => {
    try { return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org").hostname.toLowerCase(); } catch { return "www.gangrey.org"; }
  })();
  return html.replace(/href="([^"]+)"/g, (full, url: string) => {
    let u: URL;
    try { u = new URL(url); } catch { return full; }
    const host = u.hostname.toLowerCase();
    if (host !== selfHost && !OWN_HOST.test(host)) return full;
    if (u.searchParams.has("utm_source")) return full;
    u.searchParams.set("utm_source", source);
    u.searchParams.set("utm_medium", "email");
    return `href="${u.toString()}"`;
  });
}
