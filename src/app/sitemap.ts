import { MetadataRoute } from "next";
import { getPostsLight } from "@/lib/sanity";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org";
  let posts: Awaited<ReturnType<typeof getPostsLight>> = [];
  try { posts = await getPostsLight(); } catch {}

  const storyEntries: MetadataRoute.Sitemap = posts.map(p => ({
    url: `${siteUrl}/stories/${p.slug}`,
    lastModified: p._updatedAt ?? p.date,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [
    { url: siteUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    ...storyEntries,
  ];
}
