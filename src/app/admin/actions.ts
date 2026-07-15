"use server";

import { revalidatePath } from "next/cache";
import { parseBody } from "@/lib/parseBody";
import { requireAuth, requireAdmin } from "@/lib/adminAuth";
import { fullName } from "@/lib/users";
import { client } from "@/lib/sanity";
import { straightenQuotes, straightenBlocks } from "@/lib/straighten";
import { postImageUrl } from "@/lib/sanityImage";
import {
  isSqliteBackend, sqliteSavePost, sqliteDeletePost, sqliteSetStatus,
  sqliteSnapshotVersion, sqliteGetVersions, sqliteSetSingleton, sqliteMutate,
} from "@/lib/storage/sqlite";

// Pre-generate the resized/cropped derivatives readers will request for a
// featured photo, so nobody waits on a cold sharp resize. Fire-and-forget
// against the app's own /media route (self-host: localhost). The sizes mirror
// what the hero, OG card, and story-list thumbnails actually ask for.
function warmImageDerivatives(src: string, crops: Record<string, { x: number; y: number; w: number; h: number }> | undefined) {
  if (!src || !src.startsWith("/media/")) return;
  const image = { url: src, crops: crops as never };
  // Hero srcset (1600/1200/800×...9), OG card (1200×630), and story-list
  // thumbnails. The 800×450 + 1200×675 pair is what phones actually request
  // off the responsive hero, so warming them keeps the first mobile visitor
  // off a cold resize.
  const sizes: [number, number][] = [[1600, 900], [1200, 675], [800, 450], [1200, 630], [720, 540], [640, 474], [520, 293]];
  for (const [w, h] of sizes) {
    const u = postImageUrl(image, w, h);
    if (!u) continue;
    // Warm both encodings: browsers/Gmail's proxy request WebP, so warm that
    // (Accept: image/webp) alongside the JPEG fallback. Each format caches to a
    // separate file, so the first real reader hits a warm cache either way.
    fetch(`http://localhost:3000${u}`, { headers: { accept: "image/webp,image/*,*/*" } }).catch(() => {});
    fetch(`http://localhost:3000${u}`, { headers: { accept: "image/jpeg,*/*" } }).catch(() => {});
  }
}

// Enforce house style (straight quotes) on every text field at save time, so
// stored data is straight regardless of where it was typed (rich editor or
// plain input). Guarded for null/undefined.
const sq = (s: string | null | undefined) =>
  typeof s === "string" ? straightenQuotes(s) : s;

// All writes go to the local sqlite store — Sanity was fully removed. The name
// survives from the Sanity era so the dozens of call sites below don't churn.
async function mutate(mutations: unknown[]) {
  sqliteMutate(mutations);
  return { results: [] };
}

export async function uploadImage(formData: FormData) {
  await requireAuth();
  const file = formData.get("file") as File;
  if (!file) throw new Error("No file provided");
  const buf = Buffer.from(await file.arrayBuffer());
  const { sqliteSaveMedia } = await import("@/lib/storage/sqlite");
  return sqliteSaveMedia(file.name, buf);
}

export async function createDraft(providedSlug?: string): Promise<{ slug: string }> {
  await requireAuth();
  const slug = providedSlug ?? `untitled-${Date.now()}`;
  sqliteSavePost({
    _id: `post-${slug}`, slug, section: "", headline: "", subheadline: "",
    byline: "", date: new Date().toISOString().slice(0, 10), status: "draft", access: "free",
    body: [],
  });
  return { slug };
}

// Creates a standalone draft post from a newsletter card so it can be edited and
// published on its own. Returns the new slug; the caller links to the editor.
export async function createPostFromNewsletterCard(input: {
  headline: string;
  body: unknown[];
  byline?: string;
  section?: string;
  image?: { assetId: string; caption?: string; alt?: string } | null;
}): Promise<{ slug: string }> {
  await requireAuth();
  const base = (input.headline || "untitled")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
  // Prefer the clean headline slug; only add a disambiguating suffix when a
  // post already owns it (e.g. the draft button was clicked twice).
  const { sqliteGetPost } = await import("@/lib/storage/sqlite");
  const slug = sqliteGetPost(base) ? `${base}-${Date.now().toString(36)}` : base;
  const doc: Record<string, unknown> = {
    _id: `post-${slug}`,
    _type: "post",
    headline: input.headline || "",
    subheadline: "",
    slug: { _type: "slug", current: slug },
    section: input.section || "",
    byline: input.byline || "",
    date: new Date().toISOString().slice(0, 10),
    body: Array.isArray(input.body) ? input.body : [],
    status: "draft",
  };
  if (input.image?.assetId) {
    doc.image = {
      _type: "image",
      asset: { _type: "reference", _ref: input.image.assetId },
      ...(input.image.caption ? { caption: input.image.caption } : {}),
      ...(input.image.alt ? { alt: input.image.alt } : {}),
    };
  }
  // Route by backend like every other write in this file — the bare Sanity
  // mutate() throws "Missing Sanity config" on the self-hosted sqlite build.
  if (isSqliteBackend()) sqliteMutate([{ createOrReplace: doc }]);
  else await mutate([{ createOrReplace: doc }]);
  return { slug };
}

export async function savePost(formData: FormData) {
  const me = await requireAuth();
  const id = formData.get("id") as string;
  const headline = formData.get("headline") as string;
  const subheadline = formData.get("subheadline") as string;
  const byline = (formData.get("byline") as string) || "";
  const slug = formData.get("slug") as string;
  const section = formData.get("section") as string;
  const date = formData.get("date") as string;
  const readingTimeRaw = formData.get("readingTime") as string | null;
  const readingTime = readingTimeRaw && !Number.isNaN(Number(readingTimeRaw)) && Number(readingTimeRaw) > 0
    ? Number(readingTimeRaw) : null;
  const bodyRaw = formData.get("body") as string;
  const imageAssetId = formData.get("imageAssetId") as string | null;
  const imageCaption = formData.get("imageCaption") as string | null;
  const imageAlt = formData.get("imageAlt") as string | null;
  // Per-aspect-ratio manual crop rectangles (JSON), applied by the /media route.
  let imageCrops: Record<string, { x: number; y: number; w: number; h: number }> | undefined;
  try { const c = formData.get("imageCrops") as string | null; if (c) imageCrops = JSON.parse(c); } catch {}
  const status = (formData.get("status") as string) || "draft";
  // Reader access. Archive posts are always members-only, so their access field
  // is irrelevant; other sections default to "free" unless marked "paid".
  const access = (formData.get("access") as string) === "paid" ? "paid" : "free";
  const scheduledAt = (formData.get("scheduledAt") as string) || null;
  const shouldSnapshot = formData.get("snapshot") === "1";
  const pinHero = formData.get("pinHero") === "1";
  const pinTop = formData.get("pinTop") === "1";
  const archiveFree = formData.get("archiveFree") === "1";
  const seoHeadline = (formData.get("seoHeadline") as string) || null;
  const socialHeadline = (formData.get("socialHeadline") as string) || null;
  const socialDescription = (formData.get("socialDescription") as string) || null;
  const sortOrderRaw = formData.get("sortOrder") as string | null;
  const sortOrder = sortOrderRaw && !Number.isNaN(Number(sortOrderRaw)) && sortOrderRaw.trim() !== ""
    ? Number(sortOrderRaw) : null;

  let body: unknown;
  try {
    const parsed = JSON.parse(bodyRaw);
    if (Array.isArray(parsed)) body = parsed;
    else body = parseBody(bodyRaw);
  } catch {
    body = parseBody(bodyRaw);
  }

  const straightBody = Array.isArray(body) ? straightenBlocks(body) : body;

  const doc: Record<string, unknown> = {
    _id: id || `post-${slug}`,
    _type: "post",
    headline: sq(headline), subheadline: sq(subheadline),
    slug: { _type: "slug", current: slug },
    section, byline: sq(byline), date, body: straightBody, status, access,
    ...(readingTime ? { readingTime } : { readingTime: null }),
    ...(sortOrder != null ? { sortOrder } : {}),
    ...(scheduledAt ? { scheduledAt } : {}),
    // Record who scheduled it (cleared when it's no longer scheduled).
    scheduledBy: status === "scheduled" ? fullName(me) : null,
    // Audit stamp — who last edited this post and when.
    lastEditedBy: fullName(me),
    lastEditedAt: new Date().toISOString(),
    ...(seoHeadline ? { seoHeadline: sq(seoHeadline) } : {}),
    ...(socialHeadline ? { socialHeadline: sq(socialHeadline) } : {}),
    ...(socialDescription ? { socialDescription: sq(socialDescription) } : {}),
  };

  if (imageAssetId) {
    doc.image = {
      _type: "image",
      asset: { _type: "reference", _ref: imageAssetId },
      ...(imageCaption ? { caption: sq(imageCaption) } : {}),
      ...(imageAlt ? { alt: sq(imageAlt) } : {}),
      ...(imageCrops ? { crops: imageCrops } : {}),
    };
    // Keep the Media Library's own record of this asset in sync too — caption/alt
    // set here previously only lived on the post, so the library showed blank.
    if (imageCaption || imageAlt) {
      const fields = { description: (imageCaption ? sq(imageCaption) : undefined) ?? undefined, altText: (imageAlt ? sq(imageAlt) : undefined) ?? undefined };
      if (isSqliteBackend()) {
        const { sqliteSetMediaMeta } = await import("@/lib/storage/sqlite");
        sqliteSetMediaMeta(imageAssetId, fields);
      } else {
        await mutate([{ patch: { id: imageAssetId, set: fields } }]).catch(() => {});
      }
    }
  }

  if (isSqliteBackend()) {
    // If the slug changed, carry the story's slug-keyed data (analytics events,
    // view/like counters, comments) over to the new slug so nothing is orphaned
    // (stale analytics rows that 404, lost view counts).
    const { sqliteSlugForId, sqliteRenameSlugData, sqliteAddSlugRedirect } = await import("@/lib/storage/sqlite");
    const prevSlug = sqliteSlugForId(doc._id as string); // captured before the write below
    sqliteSavePost({
      _id: doc._id as string, slug, section, headline: sq(headline) as string,
      subheadline: sq(subheadline) as string, byline: sq(byline) as string,
      date, status, access, scheduledAt,
      scheduledBy: status === "scheduled" ? fullName(me) : null,
      body: straightBody,
      // Local backend stores images as plain src paths; the Sanity asset-ref
      // pipeline doesn't apply. (Media uploads on sqlite land in /public/media.)
      image: imageAssetId ? { src: imageAssetId, caption: sq(imageCaption ?? "") ?? undefined, alt: sq(imageAlt ?? "") ?? undefined, crops: imageCrops } : null,
      seoHeadline: sq(seoHeadline), socialHeadline: sq(socialHeadline), socialDescription: sq(socialDescription),
      readingTime, sortOrder, lastEditedBy: fullName(me),
    });
    // Homepage pins — a pin only makes sense for a live story, so clear both
    // when this isn't published.
    // Post row is written — now migrate slug-keyed data if the slug changed,
    // and 301 the old URL to the new one so inbound links don't break.
    if (prevSlug && prevSlug !== slug) { sqliteRenameSlugData(prevSlug, slug); sqliteAddSlugRedirect(prevSlug, slug); }
    // Warm the featured-photo derivatives on publish so the first reader doesn't
    // wait on a cold resize (only published stories are reader-visible).
    if (status === "published" && imageAssetId) warmImageDerivatives(imageAssetId, imageCrops);
    const { sqliteSetPins, sqliteSetArchiveFree } = await import("@/lib/storage/sqlite");
    sqliteSetPins(doc._id as string, status === "published" && pinHero, status === "published" && pinTop);
    sqliteSetArchiveFree(doc._id as string, archiveFree);
    // A pin change alters the homepage regardless of publish state (e.g.
    // unpinning by moving to draft), so refresh it here too.
    revalidatePath("/");
    if (shouldSnapshot || status === "published") {
      sqliteSnapshotVersion({
        slug, type: status === "published" ? "publish" : "autosave",
        headline, subheadline,
        body: Array.isArray(body) ? body : [],
        wordCount: portableWordCount(Array.isArray(body) ? body : []),
        editedBy: fullName(me),
      });
    }
    if (status === "published") {
      revalidatePath(`/stories/${slug}`);
      revalidatePath("/");
      revalidatePath("/latest");
      revalidatePath("/archive");
      revalidatePath("/brief/[read]", "page");
    }
    return { slug };
  }

  await mutate([{ createOrReplace: doc }]);
  if (shouldSnapshot || status === "published") {
    await snapshotVersion({
      postId: doc._id as string,
      slug,
      type: status === "published" ? "publish" : "autosave",
      headline, subheadline,
      body: Array.isArray(body) ? body : [],
      editedBy: fullName(me),
    });
  }
  // On publish, invalidate the cached public pages so the change appears
  // immediately instead of waiting for the 60s revalidate window.
  if (status === "published") {
    revalidatePath(`/stories/${slug}`);
    revalidatePath("/");
    revalidatePath("/latest");
    revalidatePath("/archive");
    revalidatePath("/brief/[read]", "page");
  }
  return { slug };
}

function portableWordCount(body: unknown[]): number {
  const text = body
    .filter((b): b is { _type: string; children?: { text?: string }[] } => typeof b === "object" && b !== null && (b as { _type?: string })._type === "block")
    .map(b => (b.children ?? []).map(c => c.text ?? "").join(""))
    .join(" ");
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface VersionInput { postId: string; slug: string; type: "autosave" | "publish"; headline: string; subheadline: string; body: unknown[]; editedBy?: string; }

// Saves a snapshot of the post as a separate postVersion document, then prunes
// to the most recent 20 per post. Stored in Sanity so history survives across devices.
async function snapshotVersion({ postId, slug, type, headline, subheadline, body, editedBy }: VersionInput) {
  try {
    // Skip if nothing changed since the most recent version (avoids empty saves).
    const latest = await client.fetch(
      `*[_type == "postVersion" && slug == $slug] | order(savedAt desc)[0]{ headline, subheadline, body }`,
      { slug },
      { cache: "no-store" }
    );
    if (latest &&
        latest.headline === headline &&
        latest.subheadline === subheadline &&
        JSON.stringify(latest.body ?? []) === JSON.stringify(body)) {
      return;
    }

    const versionDoc = {
      _id: `version-${slug}-${Date.now()}`,
      _type: "postVersion",
      postId, slug, type,
      savedAt: new Date().toISOString(),
      wordCount: portableWordCount(body),
      headline, subheadline, body, editedBy,
    };
    // Never delete a published snapshot — those are real milestones. Only prune
    // the oldest *autosave* versions once there are more than KEEP_AUTOSAVES of
    // them, so routine typing doesn't grow unbounded but real history survives.
    const KEEP_AUTOSAVES = 60;
    const staleAutosaves: string[] = await client.fetch(
      `*[_type == "postVersion" && slug == $slug && type != "publish"] | order(savedAt desc) [${KEEP_AUTOSAVES}...1000]._id`,
      { slug },
      { cache: "no-store" }
    );
    await mutate([
      { createOrReplace: versionDoc },
      ...staleAutosaves.map(id => ({ delete: { id } })),
    ]);
  } catch (err) {
    // Version history is best-effort — never block a save on it.
    console.error("snapshotVersion failed", err);
  }
}

export interface PostVersion {
  _id: string;
  savedAt: string;
  type: "autosave" | "publish";
  wordCount?: number;
  headline: string;
  subheadline: string;
  body: import("@portabletext/types").PortableTextBlock[];
  editedBy?: string;
}

export async function getVersions(slug: string): Promise<PostVersion[]> {
  await requireAuth();
  if (isSqliteBackend()) return sqliteGetVersions(slug);
  return client.fetch(
    `*[_type == "postVersion" && slug == $slug] | order(savedAt desc){ _id, savedAt, type, wordCount, headline, subheadline, body, editedBy }`,
    { slug },
    { cache: "no-store" }
  );
}

export async function checkSlugsExist(slugs: string[]): Promise<string[]> {
  await requireAuth();
  if (!slugs.length) return [];
  if (isSqliteBackend()) {
    const { sqliteAllPostsAdmin } = await import("@/lib/storage/sqlite");
    const set = new Set(slugs);
    return sqliteAllPostsAdmin(false).filter(p => p.status !== "trashed" && set.has(p.slug)).map(p => p.slug);
  }
  const found: { slug: string }[] = await client.fetch(
    `*[_type == "post" && slug.current in $slugs && status != "trashed"]{ "slug": slug.current }`,
    { slugs },
    { cache: "no-store" }
  );
  return found.map(f => f.slug);
}

export async function deletePost(id: string) {
  await requireAuth();
  if (isSqliteBackend()) { sqliteDeletePost(id); return; }
  await mutate([{ delete: { id } }]);
}

export async function unpublishPost(id: string) {
  await requireAuth();
  if (isSqliteBackend()) { sqliteSetStatus(id, "draft"); return; }
  await mutate([{ patch: { id, set: { status: "draft" } } }]);
}

export async function trashPost(id: string) {
  await requireAuth();
  if (isSqliteBackend()) { sqliteSetStatus(id, "trashed"); return; }
  await mutate([{ patch: { id, set: { status: "trashed" } } }]);
}

export async function restorePost(id: string) {
  await requireAuth();
  if (isSqliteBackend()) { sqliteSetStatus(id, "draft"); return; }
  await mutate([{ patch: { id, set: { status: "draft" } } }]);
}

export async function deleteMediaAsset(assetId: string) {
  await requireAuth();
  if (isSqliteBackend()) {
    const { sqliteDeleteMedia } = await import("@/lib/storage/sqlite");
    sqliteDeleteMedia(assetId);
    return;
  }
  await mutate([{ delete: { id: assetId } }]);
}

export async function updateMediaAsset(assetId: string, fields: { title?: string; description?: string; altText?: string }) {
  await requireAuth();
  if (isSqliteBackend()) {
    const { sqliteSetMediaMeta } = await import("@/lib/storage/sqlite");
    sqliteSetMediaMeta(assetId, fields);
    return;
  }
  await mutate([{ patch: { id: assetId, set: fields } }]);
}

export async function saveAbout(formData: FormData) {
  // About is admin-only (editors don't see the panel in the UI) — enforce it
  // server-side too, since a server action is callable directly.
  await requireAdmin();
  const raw = formData.get("body") as string;
  let body: unknown;
  try {
    const parsed = JSON.parse(raw);
    body = Array.isArray(parsed) ? parsed : parseBody(raw);
  } catch {
    body = parseBody(raw);
  }
  if (isSqliteBackend()) sqliteSetSingleton("about", { body });
  else await mutate([{ createOrReplace: { _id: "about", _type: "about", body } }]);
  // Refresh the cached public page immediately instead of waiting for ISR.
  revalidatePath("/about");
}

const CLOUD_DRAFT_ID = "admin-autosave";

export async function saveDraftToCloud(data: string) {
  await requireAuth();
  if (isSqliteBackend()) { sqliteSetSingleton(CLOUD_DRAFT_ID, { data, ts: Date.now() }); return; }
  await mutate([{ createOrReplace: { _id: CLOUD_DRAFT_ID, _type: "adminDraft", data, ts: Date.now() } }]);
}

export async function loadDraftFromCloud(): Promise<{ data: string; ts: number } | null> {
  await requireAuth();
  if (isSqliteBackend()) {
    const doc = (await import("@/lib/storage/sqlite")).sqliteGetSingleton<{ data: string; ts: number }>(CLOUD_DRAFT_ID);
    return doc?.data ? { data: doc.data, ts: doc.ts ?? 0 } : null;
  }
  const doc = await client.fetch(
    `*[_id == $id][0]{ data, ts }`,
    { id: CLOUD_DRAFT_ID },
    { cache: "no-store" }
  );
  return doc?.data ? { data: doc.data, ts: doc.ts ?? 0 } : null;
}

export async function clearCloudDraft() {
  // no auth check — safe to call on mount to purge stale data
  if (isSqliteBackend()) { try { sqliteSetSingleton(CLOUD_DRAFT_ID, { data: "", ts: 0 }); } catch {} return; }
  try { await mutate([{ delete: { id: CLOUD_DRAFT_ID } }]); } catch {}
}

export async function saveWelcome(headline: string, body: string) {
  await requireAuth();
  if (isSqliteBackend()) sqliteSetSingleton("welcome", { headline, body });
  else await mutate([{ createOrReplace: { _id: "welcome", _type: "welcome", headline, body } }]);
  revalidatePath("/");
}

export async function saveLately(formData: FormData) {
  await requireAuth();
  const reading = formData.get("reading") as string;
  const readingAuthor = formData.get("readingAuthor") as string;
  const readingUrl = formData.get("readingUrl") as string;
  const listening = formData.get("listening") as string;
  const listeningArtist = formData.get("listeningArtist") as string;
  const listeningUrl = formData.get("listeningUrl") as string;
  const watching = formData.get("watching") as string;
  const watchingUrl = formData.get("watchingUrl") as string;
  const doc: Record<string, unknown> = {
    _id: "lately", _type: "lately",
    reading, readingAuthor, readingUrl, listening, listeningArtist, listeningUrl, watching, watchingUrl,
  };

  if (isSqliteBackend()) sqliteSetSingleton("lately", doc);
  else await mutate([{ createOrReplace: doc }]);
  revalidatePath("/");
}
