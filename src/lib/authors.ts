import { listAllUsers, fullName, type FlatplanUser } from "./users";
import { sqliteAllPublishedPostsLight } from "./storage/sqlite";
import type { Post } from "./content";

// Author pages are built from Imago users (their photo, bio and job title),
// and exist only once that writer has a published story. Bylines that don't
// belong to an Imago user (most of the imported archive) stay plain text.

export type Author = {
  slug: string;
  name: string;          // display name: the user's byline field, else full name
  jobTitle?: string;
  bio?: string;
  photoUrl?: string;
  stories: Post[];       // published, newest first
};

export function authorSlug(name: string): string {
  return name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function displayName(u: FlatplanUser): string {
  return (u.byline ?? "").trim() || fullName(u);
}

// Every active Imago user with at least one published story under their name.
// One pass over the light post rows; called from pages that are already
// per-request, so no caching layer is needed at this scale.
export function listPublishedAuthors(): Author[] {
  const posts = sqliteAllPublishedPostsLight();
  const byByline = new Map<string, Post[]>();
  for (const p of posts) {
    const b = (p.byline ?? "").trim();
    if (!b) continue;
    (byByline.get(b) ?? byByline.set(b, []).get(b)!).push(p);
  }
  const authors: Author[] = [];
  const seen = new Set<string>();
  // listAllUsers is async only for interface symmetry elsewhere; the doc read
  // itself is sync. Read docs directly to keep this function sync for pages.
  for (const u of usersSync()) {
    if (!u.active) continue;
    const name = displayName(u);
    const stories = byByline.get(name);
    if (!stories || stories.length === 0) continue;
    const slug = authorSlug(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    authors.push({
      slug,
      name,
      jobTitle: u.jobTitle || undefined,
      bio: u.bio || undefined,
      photoUrl: u.photoUrl || undefined,
      stories: [...stories].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    });
  }
  return authors.sort((a, b) => {
    const lastA = a.name.split(/\s+/).at(-1)!.toLowerCase();
    const lastB = b.name.split(/\s+/).at(-1)!.toLowerCase();
    return lastA.localeCompare(lastB);
  });
}

// Sync mirror of listAllUsers (which only wraps this same doc read).
function usersSync(): FlatplanUser[] {
  // Local import to avoid a cycle at module load.
  const { sqliteDocsByType } = require("./storage/sqlite") as typeof import("./storage/sqlite");
  return sqliteDocsByType<FlatplanUser & { photo?: { asset?: { _ref?: string } } }>("user")
    .map(u => ({ ...u, photoUrl: u.photoUrl ?? u.photo?.asset?._ref ?? undefined }));
}

export function getAuthorBySlug(slug: string): Author | null {
  return listPublishedAuthors().find(a => a.slug === slug) ?? null;
}

// Href for a story byline, or null when the name has no author page — the
// story page uses this to decide between a link and plain text.
export function authorHrefForByline(byline: string): string | null {
  const name = (byline ?? "").trim();
  if (!name) return null;
  const a = listPublishedAuthors().find(x => x.name === name);
  return a ? `/authors/${a.slug}` : null;
}
