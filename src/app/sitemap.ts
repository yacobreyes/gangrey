import { MetadataRoute } from "next";
import { getPostsLight, getAllIssues } from "@/lib/sanity";

// Sitemap: the map Google crawls to discover and prioritize pages. Includes
// the public landing pages (previously missing — only the homepage and stories
// were listed), every published story, and every issue. Fresh, free stories
// carry a higher priority than the members-only archive so a young domain's
// crawl budget favors current work over 3,000+ gated back-catalog URLs.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org";

  let posts: Awaited<ReturnType<typeof getPostsLight>> = [];
  try { posts = await getPostsLight(); } catch {}
  let issues: Awaited<ReturnType<typeof getAllIssues>> = [];
  try { issues = await getAllIssues(); } catch {}

  // Public, indexable landing pages (excludes /account, /*/success, /recording,
  // /delorean and /admin, which are noindex or crawler-blocked).
  const staticEntries: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/latest`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${siteUrl}/archive`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${siteUrl}/issues`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${siteUrl}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/subscribe`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${siteUrl}/submit`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/authors`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${siteUrl}/store`, changeFrequency: "monthly", priority: 0.4 },
  ];

  const storyEntries: MetadataRoute.Sitemap = posts.map(p => {
    const isArchive = p.section === "Archive";
    return {
      url: `${siteUrl}/stories/${p.slug}`,
      lastModified: p._updatedAt ?? p.date,
      // The recovered archive is members-only and huge; keep it in the map but
      // at a lower priority than current, free stories.
      changeFrequency: isArchive ? ("yearly" as const) : ("monthly" as const),
      priority: isArchive ? 0.4 : 0.8,
    };
  });

  const issueEntries: MetadataRoute.Sitemap = issues
    .filter(i => i.slug)
    .map(i => ({
      url: `${siteUrl}/issues/${i.slug}`,
      lastModified: i.publishedAt ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));

  return [...staticEntries, ...storyEntries, ...issueEntries];
}
