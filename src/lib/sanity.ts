import { straightenQuotes, straightenBlocks } from "./straighten";
import {
  sqliteAllPublishedPosts, sqliteGetPost, sqliteGetSingleton,
  sqliteAllPublishedPostsLight, sqliteAllPostsAdminLight, sqliteBodyTextBySlug,
  sqliteDocsByType, sqliteListMedia, sqliteGetMediaMeta,
} from "./storage/sqlite";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SanityImageSource = any;

// Re-exported for legacy server-side call sites.
export { urlFor } from "./sanityImage";

export interface SanityPost {
  _id: string;
  _updatedAt?: string;
  _createdAt?: string;
  slug: string;
  section: "Micro-Memoir" | "Narratives" | "Essays" | "Archive" | "";
  headline: string;
  subheadline: string;
  byline: string;
  date: string;
  body: import("@portabletext/types").PortableTextBlock[];
  image?: { asset: SanityImageSource; url?: string; caption?: string; alt?: string; crops?: import("./sanityImage").ImageCrops };
  status?: "draft" | "published" | "scheduled" | "trashed";
  scheduledAt?: string;
  scheduledBy?: string;
  // The moment the story first went live (stable; not overwritten by edits).
  publishedAt?: string;
  // Editorial workflow: pipeline stage + assigned editor (for the Calendar).
  stage?: string;
  assignee?: string;
  // Audit stamp — who saved this post last and when (set on every save).
  lastEditedBy?: string;
  lastEditedAt?: string;
  // Reader access: "free" (public, default) or "paid" (members only).
  // Archive posts are always members-only regardless of this field.
  access?: "free" | "paid";
  seoHeadline?: string;
  socialHeadline?: string;
  socialDescription?: string;
  readingTime?: number;
  sortOrder?: number;
  searchText?: string;
  // Homepage pins (self-hosted): pinnedHero → the big hero; pinnedTop → forced
  // into the Top Stories row.
  pinnedHero?: boolean;
  pinnedTop?: boolean;
  // Archive stories are members-only by default; this frees an individual one.
  archiveFree?: boolean;
}

const sQ = (s?: string) => (typeof s === "string" ? straightenQuotes(s) : s);

// Enforce straight quotes on the way out so existing/archive content (which
// was imported with curly quotes) renders in house style everywhere.
function straightenPost(p: SanityPost): SanityPost {
  return {
    ...p,
    headline: sQ(p.headline) as string,
    subheadline: sQ(p.subheadline) as string,
    byline: sQ(p.byline) as string,
    seoHeadline: sQ(p.seoHeadline),
    socialHeadline: sQ(p.socialHeadline),
    socialDescription: sQ(p.socialDescription),
    searchText: sQ(p.searchText),
    body: p.body ? straightenBlocks(p.body) : p.body,
    image: p.image
      ? { ...p.image, caption: sQ(p.image.caption), alt: sQ(p.image.alt) }
      : p.image,
  };
}

export async function getAllPosts(): Promise<SanityPost[]> {
  return sqliteAllPublishedPosts().map(straightenPost);
}

// Lightweight variant for listing pages (homepage, /latest) that only display
// metadata and need body solely for client-side search. Drops the heavy
// portable-text body and substitutes a server-computed plain-text searchText,
// drastically shrinking the payload shipped to the browser.
// `withSearch` pulls each post's full body text for client-side search. Default
// (false) keeps the homepage payload small for fast navigation back to it.
export async function getPostsLight(withSearch = false): Promise<SanityPost[]> {
  // Light rows only — with the imported archive, full bodies here meant
  // parsing ~2,500 stories per request AND shipping them to the browser.
  // searchText is computed from a targeted slug->text query only when a
  // search actually needs it.
  const posts = sqliteAllPublishedPostsLight();
  if (!withSearch) return posts.map(straightenPost);
  const text = sqliteBodyTextBySlug(true);
  return posts.map(p => straightenPost({ ...p, searchText: text[p.slug] ?? "" }));
}


// `withSearch` pulls each post's full body text for client-side search. The
// dashboard's first server render keeps it false so navigation isn't blocked by
// shipping every post's body; the client then refetches the searchable version.
// `excludeArchive` drops the bulk-imported Archive pieces (2500+) which would
// otherwise make the editorial dashboard slow to load and unwieldy to scroll.
export async function getAllPostsAdmin(withSearch = false, excludeArchive = false): Promise<SanityPost[]> {
  const posts = sqliteAllPostsAdminLight(excludeArchive);
  if (!withSearch) return posts.map(straightenPost);
  const text = sqliteBodyTextBySlug(false);
  return posts.map(p => straightenPost({ ...p, searchText: text[p.slug] ?? "" }));
}

// Archive pieces only, for the dashboard's Archive panel.
export async function getArchivePostsAdmin(): Promise<SanityPost[]> {
  return sqliteAllPostsAdminLight(false).filter(p => p.section === "Archive").map(straightenPost);
}

// Public archive listing. The old /archive page pulled full portable-text
// bodies for every published post via getAllPosts() — thousands of docs — which
// blew past Sanity's response limits and left the page empty. Here we fetch
// ONLY archive posts and only their plain text (pt::text), then wrap it in a
// single synthetic block so the GangreyArchive component (which reads
// body[].children[].text for search/excerpt/reading-time) works unchanged.
export async function getArchivePosts(): Promise<SanityPost[]> {
  // Plain text wrapped in one synthetic block, so the archive page's
  // search/excerpt/reading-time logic works without parsing thousands of full
  // portable-text bodies. Scoped to the Archive section (was querying every
  // published post site-wide) and capped per-post, since list views only ever
  // show a short excerpt.
  const text = sqliteBodyTextBySlug(true, "Archive");
  return sqliteAllPublishedPostsLight().filter(p => p.section === "Archive").map(p => straightenPost({
    ...p,
    body: [{ _type: "block", style: "normal", children: [{ _type: "span", text: text[p.slug] ?? "" }] }] as SanityPost["body"],
  }));
}

// Newsletter list for the dashboard, server-rendered so drafts appear on first
// paint instead of popping in after a client fetch. Mirrors the shape returned
// by /api/newsletter (which the client uses for live refreshes).
export type AdminNewsletterListItem = {
  _id: string; subject?: string; preview?: string; author?: string;
  wordCount?: number; cards?: unknown[]; status?: "draft" | "published" | "scheduled";
  scheduledAt?: string; createdAt?: string; updatedAt?: string; sentAt?: string;
};
export async function getAllNewslettersAdmin(): Promise<AdminNewsletterListItem[]> {
  return sqliteDocsByType<AdminNewsletterListItem & { updatedAt?: string; createdAt?: string }>("newsletter")
    .sort((a, b) => ((b.updatedAt ?? b.createdAt ?? "")).localeCompare(a.updatedAt ?? a.createdAt ?? ""));
}

// Media library for the admin panel, server-rendered so the grid paints
// populated instead of popping in. Shared with /api/media (client refresh).
export type AdminMediaAsset = {
  _id: string; _createdAt: string; url: string; originalFilename?: string;
  title?: string; description?: string; altText?: string;
  metadata?: { dimensions?: { width: number; height: number }; size?: number };
  usedIn?: { slug: string; headline: string }[];
};
export async function getMediaLibrary(): Promise<AdminMediaAsset[]> {
  const usage: Record<string, { slug: string; headline: string }[]> = {};
  for (const p of sqliteAllPostsAdminLight(false)) {
    if (p.image?.url) (usage[p.image.url] ??= []).push({ slug: p.slug, headline: p.headline });
  }
  return sqliteListMedia().map(m => {
    const meta = sqliteGetMediaMeta(m._id);
    return {
      _id: m._id, _createdAt: m._createdAt, url: m.url, originalFilename: m.originalFilename,
      title: meta.title, description: meta.description, altText: meta.altText,
      metadata: { size: m.size }, usedIn: usage[m.url] ?? [],
    };
  });
}

// Subscriber list for the admin panel, server-rendered for an instant first
// paint. The panel still calls getSubscribers() in the background, which also
// reconciles statuses against the provider.
export type AdminSubscriber = { email: string; status?: "active" | "neutral" | "inactive"; createdAt?: string };
export async function listSubscribers(): Promise<AdminSubscriber[]> {
  return sqliteDocsByType<AdminSubscriber>("subscriber")
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export async function getPost(slug: string): Promise<SanityPost | null> {
  const p = sqliteGetPost(slug);
  return p ? straightenPost(p) : null;
}

export async function getAllSlugs(): Promise<string[]> {
  return sqliteAllPostsAdminLight(false).map(p => p.slug);
}

export interface SanityIssue {
  _id: string;
  slug: string;
  number: number;
  title: string;
  description?: string;
  publishedAt: string;
  url?: string;
  newsletterId?: string;
}

export async function getAllIssues(): Promise<SanityIssue[]> {
  return sqliteDocsByType<Omit<SanityIssue, "slug"> & { slug?: { current?: string } | string }>("issue")
    .map(i => ({ ...i, slug: typeof i.slug === "object" && i.slug ? (i.slug.current ?? "") : ((i.slug as string) ?? "") }))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")) as SanityIssue[];
}

export interface SanityAbout {
  body: import("@portabletext/types").PortableTextBlock[];
}

export async function getAboutPage(): Promise<SanityAbout | null> {
  return sqliteGetSingleton<SanityAbout>("about");
}

export interface SanityLately {
  reading?: string;
  readingAuthor?: string;
  readingUrl?: string;
  listening?: string;
  listeningArtist?: string;
  listeningUrl?: string;
  watching?: string;
  watchingUrl?: string;
}

export async function getLately(): Promise<SanityLately | null> {
  return sqliteGetSingleton<SanityLately>("lately");
}

export interface SanityWelcome { headline: string; body: string; }

export async function getWelcome(): Promise<SanityWelcome | null> {
  return sqliteGetSingleton<SanityWelcome>("welcome");
}
