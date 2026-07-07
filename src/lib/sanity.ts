import { createClient } from "next-sanity";
import { straightenQuotes, straightenBlocks } from "./straighten";
import {
  isSqliteBackend, sqliteAllPublishedPosts, sqliteAllPostsAdmin, sqliteGetPost, sqliteGetSingleton,
  sqliteAllPublishedPostsLight, sqliteAllPostsAdminLight, sqliteBodyTextBySlug,
  sqliteDocsByType, sqliteListMedia, sqliteGetMediaMeta,
} from "./storage/sqlite";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SanityImageSource = any;

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";

// The Vercel-Sanity integration sets SANITY_API_READ_TOKEN for server-side reads
const token = process.env.SANITY_API_READ_TOKEN;

export const client = createClient({
  projectId,
  dataset,
  apiVersion: "2024-01-01",
  useCdn: !token,
  token,
});

// CDN-backed, tokenless client for large reads of published content (e.g. the
// 2500+ archive pieces). The edge CDN is far faster than the authenticated API,
// and archive posts are all published so no token is needed.
const clientCdn = createClient({
  projectId,
  dataset,
  apiVersion: "2024-01-01",
  useCdn: true,
});

// Re-exported for server-side call sites — client components should import
// from "@/lib/sanityImage" directly so they don't pull in next-sanity's
// createClient (this file) just to build an image URL.
export { urlFor } from "./sanityImage";

// Retry a Sanity read a few times with backoff. Sanity's authenticated API is
// rate-limited; a transient 429/5xx would otherwise blank the whole admin
// dashboard. Retrying turns a momentary throttle into a slightly slower load.
export async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

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

// Lightweight field set for the admin dashboard list — excludes the heavy
// portable-text `body` (which can be huge across the full archive) and
// replaces it with a server-computed plain-text string for search only.
const POST_LIST_FIELDS = `
  _id,
  "slug": slug.current,
  section,
  headline,
  subheadline,
  byline,
  date,
  _updatedAt,
  _createdAt,
  "body": [],
  image { asset, caption, alt },
  status,
  access,
  scheduledAt,
  lastEditedBy,
  lastEditedAt,
  "readingTime": coalesce(readingTime, round(length(pt::text(body)) / 1100) + 1),
  sortOrder
`;

// Same as above plus the heavy full-text search field. Only used when a search
// query is active — shipping every post's body text on a normal homepage load
// bloats the payload across the whole archive and slows navigation.
const POST_LIST_FIELDS_SEARCH = `${POST_LIST_FIELDS},
  "searchText": pt::text(body)
`;

const POST_FIELDS = `
  _id,
  "slug": slug.current,
  section,
  headline,
  subheadline,
  byline,
  date,
  _updatedAt,
  _createdAt,
  body,
  image { asset, caption, alt },
  status,
  access,
  scheduledAt,
  lastEditedBy,
  lastEditedAt,
  seoHeadline,
  socialHeadline,
  socialDescription,
  readingTime,
  sortOrder
`;

const POSTS_QUERY = `*[_type == "post" && (
  status == "published" ||
  !defined(status) ||
  (status == "scheduled" && scheduledAt <= now())
)] | order(date desc) { ${POST_FIELDS} }`;

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

// Plain text of a post body — used to synthesize the searchText field that the
// GROQ queries compute server-side, when serving from the SQLite backend.
function bodyText(p: SanityPost): string {
  return (p.body ?? [])
    .filter(b => (b as { _type?: string })._type === "block")
    .map(b => ((b as { children?: { text?: string }[] }).children ?? []).map(c => c.text ?? "").join(""))
    .join(" ");
}

export async function getAllPosts(): Promise<SanityPost[]> {
  if (isSqliteBackend()) return sqliteAllPublishedPosts().map(straightenPost);
  const posts: SanityPost[] = await client.fetch(POSTS_QUERY, {}, { next: { revalidate: 60 } });
  return posts.map(straightenPost);
}

// Lightweight variant for listing pages (homepage, /latest) that only display
// metadata and need body solely for client-side search. Drops the heavy
// portable-text body and substitutes a server-computed plain-text searchText,
// drastically shrinking the payload shipped to the browser.
const POSTS_LIGHT_FILTER = `*[_type == "post" && (
  status == "published" ||
  !defined(status) ||
  (status == "scheduled" && scheduledAt <= now())
)] | order(date desc)`;

// `withSearch` pulls each post's full body text for client-side search. Default
// (false) keeps the homepage payload small for fast navigation back to it.
export async function getPostsLight(withSearch = false): Promise<SanityPost[]> {
  if (isSqliteBackend()) {
    // Light rows only — with the imported archive, full bodies here meant
    // parsing ~2,500 stories per request AND shipping them to the browser.
    // searchText is computed from a targeted slug->text query only when a
    // search actually needs it.
    const posts = sqliteAllPublishedPostsLight();
    if (!withSearch) return posts.map(straightenPost);
    const text = sqliteBodyTextBySlug(true);
    return posts.map(p => straightenPost({ ...p, searchText: text[p.slug] ?? "" }));
  }
  const fields = withSearch ? POST_LIST_FIELDS_SEARCH : POST_LIST_FIELDS;
  const posts: SanityPost[] = await client.fetch(
    `${POSTS_LIGHT_FILTER} { ${fields} }`,
    {},
    { next: { revalidate: 60 } }
  );
  return posts.map(straightenPost);
}


// `withSearch` pulls each post's full body text for client-side search. The
// dashboard's first server render keeps it false so navigation isn't blocked by
// shipping every post's body; the client then refetches the searchable version.
// `excludeArchive` drops the bulk-imported Archive pieces (2500+) which would
// otherwise make the editorial dashboard slow to load and unwieldy to scroll.
export async function getAllPostsAdmin(withSearch = false, excludeArchive = false): Promise<SanityPost[]> {
  if (isSqliteBackend()) {
    const posts = sqliteAllPostsAdminLight(excludeArchive);
    if (!withSearch) return posts.map(straightenPost);
    const text = sqliteBodyTextBySlug(false);
    return posts.map(p => straightenPost({ ...p, searchText: text[p.slug] ?? "" }));
  }
  const fields = withSearch ? POST_LIST_FIELDS_SEARCH : POST_LIST_FIELDS;
  const archiveFilter = excludeArchive ? ` && section != "Archive"` : "";
  const posts: SanityPost[] = await withRetry(() => client.fetch(
    `*[_type == "post" && !(_id in path("drafts.**"))${archiveFilter}] | order(_updatedAt desc) { ${fields} }`,
    {},
    { cache: "no-store" }
  ));
  return posts.map(straightenPost);
}

// Archive pieces only, for the dashboard's Archive panel. The rows only render
// headline/byline/section/date, so we fetch ONLY those — skipping the expensive
// per-post readingTime computation (pt::text(body) over 2500 docs) and image
// resolution that POST_LIST_FIELDS pays for. Cached briefly so repeat opens are
// instant; archive content effectively never changes.
const ARCHIVE_LIST_FIELDS = `
  _id, "slug": slug.current, section, headline, byline, date,
  _updatedAt, _createdAt, status, "body": []
`;
export async function getArchivePostsAdmin(): Promise<SanityPost[]> {
  if (isSqliteBackend()) {
    return sqliteAllPostsAdminLight(false).filter(p => p.section === "Archive").map(straightenPost);
  }
  const posts: SanityPost[] = await clientCdn.fetch(
    `*[_type == "post" && !(_id in path("drafts.**")) && section == "Archive"] | order(date desc) { ${ARCHIVE_LIST_FIELDS} }`,
    {},
    { next: { revalidate: 300 } }
  );
  return posts.map(straightenPost);
}

// Public archive listing. The old /archive page pulled full portable-text
// bodies for every published post via getAllPosts() — thousands of docs — which
// blew past Sanity's response limits and left the page empty. Here we fetch
// ONLY archive posts and only their plain text (pt::text), then wrap it in a
// single synthetic block so the GangreyArchive component (which reads
// body[].children[].text for search/excerpt/reading-time) works unchanged.
export async function getArchivePosts(): Promise<SanityPost[]> {
  if (isSqliteBackend()) {
    // Same trick as the Sanity path below: plain text wrapped in one synthetic
    // block, so the archive page's search/excerpt/reading-time logic works
    // without parsing 2,500 full portable-text bodies.
    const text = sqliteBodyTextBySlug(true);
    return sqliteAllPublishedPostsLight().filter(p => p.section === "Archive").map(p => straightenPost({
      ...p,
      body: [{ _type: "block", style: "normal", children: [{ _type: "span", text: text[p.slug] ?? "" }] }] as SanityPost["body"],
    }));
  }
  type Row = { _id: string; slug: string; section: SanityPost["section"]; headline: string; byline: string; date: string; status?: SanityPost["status"]; sortOrder?: number; plain?: string };
  const rows: Row[] = await clientCdn.fetch(
    `*[_type == "post" && !(_id in path("drafts.**")) && section == "Archive" && (status == "published" || !defined(status))] | order(date desc) {
      _id, "slug": slug.current, section, headline, byline, date, status, sortOrder,
      "plain": pt::text(body)
    }`,
    {},
    { next: { revalidate: 300 } }
  );
  return rows.map(r => straightenPost({
    _id: r._id,
    slug: r.slug,
    section: r.section,
    headline: r.headline,
    subheadline: "",
    byline: r.byline,
    date: r.date,
    status: r.status,
    sortOrder: r.sortOrder,
    body: r.plain
      ? [{ _type: "block", _key: "t", style: "normal", markDefs: [], children: [{ _type: "span", _key: "s", text: r.plain, marks: [] }] }]
      : [],
  } as SanityPost));
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
  if (isSqliteBackend()) {
    return sqliteDocsByType<AdminNewsletterListItem & { updatedAt?: string; createdAt?: string }>("newsletter")
      .sort((a, b) => ((b.updatedAt ?? b.createdAt ?? "")).localeCompare(a.updatedAt ?? a.createdAt ?? ""));
  }
  const list: AdminNewsletterListItem[] = await withRetry(() => client.fetch(
    `*[_type == "newsletter"] | order(coalesce(updatedAt, createdAt) desc){
      _id, subject, preview, author, wordCount, cards, status, scheduledAt, createdAt, updatedAt, sentAt
    }`,
    {},
    { cache: "no-store" }
  ));
  return list ?? [];
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
  if (isSqliteBackend()) {
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
  const [assets, posts] = await withRetry(() => Promise.all([
    client.fetch(
      `*[_type == "sanity.imageAsset"] | order(_createdAt desc) {
        _id, _createdAt, url, originalFilename, title, description, altText,
        metadata { dimensions { width, height }, size }
      }`,
      {},
      { cache: "no-store" }
    ),
    client.fetch(
      `*[_type == "post" && defined(image.asset._ref)] { "slug": slug.current, headline, "assetId": image.asset._ref }`,
      {},
      { cache: "no-store" }
    ),
  ]));
  const usageMap: Record<string, { slug: string; headline: string }[]> = {};
  for (const p of posts ?? []) {
    (usageMap[p.assetId] ??= []).push({ slug: p.slug, headline: p.headline });
  }
  return (assets ?? []).map((a: AdminMediaAsset) => ({ ...a, usedIn: usageMap[a._id] ?? [] }));
}

// Subscriber list for the admin panel, server-rendered for an instant first
// paint. The panel still calls getSubscribers() in the background, which also
// reconciles statuses against the provider.
export type AdminSubscriber = { email: string; status?: "active" | "neutral" | "inactive"; createdAt?: string };
export async function listSubscribers(): Promise<AdminSubscriber[]> {
  if (isSqliteBackend()) {
    return sqliteDocsByType<AdminSubscriber>("subscriber")
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }
  const list: AdminSubscriber[] = await client.fetch(
    `*[_type == "subscriber"] | order(createdAt desc){ email, status, createdAt }`,
    {},
    { cache: "no-store" }
  );
  return list ?? [];
}

export async function getPost(slug: string): Promise<SanityPost | null> {
  if (isSqliteBackend()) {
    const p = sqliteGetPost(slug);
    return p ? straightenPost(p) : null;
  }
  const post: SanityPost | null = await client.fetch(
    `*[_type == "post" && slug.current == $slug][0] { ${POST_FIELDS} }`,
    { slug },
    { next: { revalidate: 60 } }
  );
  return post ? straightenPost(post) : null;
}

export async function getAllSlugs(): Promise<string[]> {
  if (isSqliteBackend()) return sqliteAllPostsAdminLight(false).map(p => p.slug);
  return client.fetch(`*[_type == "post"].slug.current`, {}, { next: { revalidate: 300 } });
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
  if (isSqliteBackend()) {
    return sqliteDocsByType<Omit<SanityIssue, "slug"> & { slug?: { current?: string } | string }>("issue")
      .map(i => ({ ...i, slug: typeof i.slug === "object" && i.slug ? (i.slug.current ?? "") : ((i.slug as string) ?? "") }))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")) as SanityIssue[];
  }
  return client.fetch(
    `*[_type == "issue"] | order(publishedAt desc) { _id, "slug": slug.current, number, title, description, publishedAt, url, newsletterId }`,
    {}, { next: { revalidate: 60 } }
  );
}

export interface SanityAbout {
  body: import("@portabletext/types").PortableTextBlock[];
}

export async function getAboutPage(): Promise<SanityAbout | null> {
  if (isSqliteBackend()) return sqliteGetSingleton<SanityAbout>("about");
  return client.fetch(`*[_type == "about" && _id == "about"][0] { body }`, {}, { next: { revalidate: 300 } });
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
  if (isSqliteBackend()) return sqliteGetSingleton<SanityLately>("lately");
  return client.fetch(
    `*[_type == "lately" && _id == "lately"][0] { reading, readingAuthor, readingUrl, listening, listeningArtist, listeningUrl, watching, watchingUrl }`,
    {}, { next: { revalidate: 300 } }
  );
}

export interface SanityWelcome { headline: string; body: string; }

export async function getWelcome(): Promise<SanityWelcome | null> {
  if (isSqliteBackend()) return sqliteGetSingleton<SanityWelcome>("welcome");
  return client.fetch(
    `*[_type == "welcome" && _id == "welcome"][0]{ headline, body }`,
    {}, { next: { revalidate: 60 } }
  );
}
