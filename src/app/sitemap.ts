import { MetadataRoute } from "next";
import { getPostsLight, getAllIssues } from "@/lib/content";

// Sitemap: the map Google crawls to discover and prioritize pages. Includes
// the public landing pages, every published story, and every issue.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org";

  let posts: Awaited<ReturnType<typeof getPostsLight>> = [];
  try { posts = await getPostsLight(); } catch {}
  let issues: Awaited<ReturnType<typeof getAllIssues>> = [];
  try { issues = await getAllIssues(); } catch {}

  // Public, indexable landing pages (excludes /account, /*/success, /recording,
  // /delorean and /admin, which are noindex or crawler-blocked).
  const staticEntries: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/latest`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${siteUrl}/narratives`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${siteUrl}/essays`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${siteUrl}/micro-memoirs`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${siteUrl}/issues`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${siteUrl}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/subscribe`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${siteUrl}/submit`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/authors`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${siteUrl}/store`, changeFrequency: "monthly", priority: 0.4 },
  ];

  const storyEntries: MetadataRoute.Sitemap = posts.map(p => ({
    url: `${siteUrl}/stories/${p.slug}`,
    lastModified: p._updatedAt ?? p.date,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const issueEntries: MetadataRoute.Sitemap = issues
    .filter(i => i.slug)
    .map(i => ({
      url: `${siteUrl}/issues/${i.slug}`,
      lastModified: i.publishedAt ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));

  // Author pages: one per Imago writer with a published story.
  let authorEntries: MetadataRoute.Sitemap = [];
  try {
    const { listPublishedAuthors } = await import("@/lib/authors");
    authorEntries = listPublishedAuthors().map(a => ({
      url: `${siteUrl}/authors/${a.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }));
  } catch { /* empty store at build time */ }

  return [...staticEntries, ...storyEntries, ...issueEntries, ...authorEntries];
}
