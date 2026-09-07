import { getPostsLight } from "@/lib/content";
import { postImageUrl } from "@/lib/contentImage";

export const dynamic = "force-dynamic";

export async function GET() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org";
  // withSearch gives plain-text searchText for the description fallback without
  // shipping/parsing full portable-text bodies.
  const posts = await getPostsLight(true);

  const items = posts
    .filter(p => p.status === "published" || !p.status)
    // Newest first; keep the feed to a sensible recent window.
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 30)
    .map(p => {
      const body = (p.searchText ?? "").slice(0, 500);

      const img = postImageUrl(p.image, 1200, 630);
      const imgAbs = img ? (img.startsWith("http") ? img : siteUrl + img) : null;

      return `
    <item>
      <title><![CDATA[${p.headline}]]></title>
      <link>${siteUrl}/stories/${p.slug}</link>
      <guid>${siteUrl}/stories/${p.slug}</guid>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <description><![CDATA[${p.subheadline || body}]]></description>
      <author>${p.byline}</author>
      <category>${p.section}</category>${imgAbs ? `
      <enclosure url="${imgAbs}" type="image/jpeg"/>` : ""}
    </item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The Sunland Tribune</title>
    <link>${siteUrl}</link>
    <description>A literary blog about the ephemeral moments that make a life.</description>
    <language>en-us</language>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
