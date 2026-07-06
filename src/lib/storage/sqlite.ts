import path from "path";
import fs from "fs";
import type { PortableTextBlock } from "@portabletext/types";
import type { SanityPost } from "@/lib/sanity";

// Self-contained SQLite storage backend for Imago. The entire database is one
// file on disk (DATA_DIR/imago.db) — no external service, no account, no
// metering. Enabled with STORAGE_BACKEND=sqlite; requires a persistent disk
// (a VPS/Docker volume), i.e. NOT Vercel serverless.
//
// better-sqlite3 is required lazily so the module can be imported in
// serverless/Sanity deployments where the native binding isn't needed.

/* eslint-disable @typescript-eslint/no-explicit-any */
let _db: any = null;

export function isSqliteBackend(): boolean {
  return process.env.STORAGE_BACKEND === "sqlite";
}

function db() {
  if (_db) return _db;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  _db = new Database(path.join(dir, "imago.db"));
  _db.pragma("journal_mode = WAL");
  migrate(_db);
  return _db;
}

function migrate(d: any) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      section TEXT DEFAULT '',
      headline TEXT DEFAULT '',
      subheadline TEXT DEFAULT '',
      byline TEXT DEFAULT '',
      date TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      access TEXT DEFAULT 'free',
      scheduled_at TEXT,
      body TEXT DEFAULT '[]',            -- portable-text JSON
      image TEXT,                        -- JSON {src, alt, caption} | null
      seo_headline TEXT,
      social_headline TEXT,
      social_description TEXT,
      reading_time INTEGER,
      sort_order INTEGER,
      created_at TEXT,
      updated_at TEXT,
      last_edited_by TEXT,
      last_edited_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_posts_status_date ON posts (status, date DESC);

    CREATE TABLE IF NOT EXISTS post_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      type TEXT NOT NULL,                -- autosave | publish
      saved_at TEXT NOT NULL,
      word_count INTEGER,
      headline TEXT DEFAULT '',
      subheadline TEXT DEFAULT '',
      body TEXT DEFAULT '[]',
      edited_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_versions_slug ON post_versions (slug, saved_at DESC);

    CREATE TABLE IF NOT EXISTS singletons (
      name TEXT PRIMARY KEY,
      data TEXT NOT NULL                 -- JSON blob (about, welcome, lately)
    );

    -- Generic JSON document store for everything that isn't a post:
    -- members, subscribers, users, newsletters, newsletterVersions, issues.
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents (type);
  `);
}

type PostRow = Record<string, any>;

function rowToPost(r: PostRow): SanityPost {
  const image = r.image ? JSON.parse(r.image) : null;
  return {
    _id: r.id,
    slug: r.slug,
    section: r.section ?? "",
    headline: r.headline ?? "",
    subheadline: r.subheadline ?? "",
    byline: r.byline ?? "",
    date: r.date ?? "",
    status: r.status ?? "draft",
    access: r.access ?? "free",
    scheduledAt: r.scheduled_at ?? undefined,
    body: JSON.parse(r.body || "[]"),
    // Local images are plain {src,...}; components using Sanity's urlFor need
    // the asset guard, so we surface src via image.url and leave asset unset.
    image: image ? { asset: undefined as any, url: image.src, caption: image.caption, alt: image.alt } : undefined,
    seoHeadline: r.seo_headline ?? undefined,
    socialHeadline: r.social_headline ?? undefined,
    socialDescription: r.social_description ?? undefined,
    readingTime: r.reading_time ?? undefined,
    sortOrder: r.sort_order ?? undefined,
    _createdAt: r.created_at ?? undefined,
    _updatedAt: r.updated_at ?? undefined,
    lastEditedBy: r.last_edited_by ?? undefined,
    lastEditedAt: r.last_edited_at ?? undefined,
  };
}

const PUBLIC_WHERE = `status != 'trashed' AND (
  status = 'published' OR status IS NULL OR status = '' OR
  (status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now'))
)`;

export function sqliteAllPublishedPosts(): SanityPost[] {
  const rows = db().prepare(`SELECT * FROM posts WHERE ${PUBLIC_WHERE} ORDER BY date DESC, COALESCE(sort_order, 0) ASC`).all();
  return rows.map(rowToPost);
}

export function sqliteAllPostsAdmin(excludeArchive = false): SanityPost[] {
  const where = excludeArchive ? `WHERE section != 'Archive'` : "";
  const rows = db().prepare(`SELECT * FROM posts ${where} ORDER BY COALESCE(updated_at, created_at) DESC`).all();
  return rows.map(rowToPost);
}

export function sqliteGetPost(slug: string): SanityPost | null {
  const row = db().prepare(`SELECT * FROM posts WHERE slug = ?`).get(slug);
  return row ? rowToPost(row) : null;
}

export function sqliteSavePost(doc: {
  _id: string; slug: string; section: string; headline: string; subheadline: string;
  byline: string; date: string; status: string; access: string;
  scheduledAt?: string | null; body: unknown; image?: { src: string; caption?: string; alt?: string } | null;
  seoHeadline?: string | null; socialHeadline?: string | null; socialDescription?: string | null;
  readingTime?: number | null; sortOrder?: number | null; lastEditedBy?: string;
}): void {
  const now = new Date().toISOString();
  db().prepare(`
    INSERT INTO posts (id, slug, section, headline, subheadline, byline, date, status, access,
      scheduled_at, body, image, seo_headline, social_headline, social_description,
      reading_time, sort_order, created_at, updated_at, last_edited_by, last_edited_at)
    VALUES (@id, @slug, @section, @headline, @subheadline, @byline, @date, @status, @access,
      @scheduledAt, @body, @image, @seoHeadline, @socialHeadline, @socialDescription,
      @readingTime, @sortOrder, @now, @now, @lastEditedBy, @now)
    ON CONFLICT(id) DO UPDATE SET
      slug=@slug, section=@section, headline=@headline, subheadline=@subheadline,
      byline=@byline, date=@date, status=@status, access=@access, scheduled_at=@scheduledAt,
      body=@body, image=@image, seo_headline=@seoHeadline, social_headline=@socialHeadline,
      social_description=@socialDescription, reading_time=@readingTime, sort_order=@sortOrder,
      updated_at=@now, last_edited_by=@lastEditedBy, last_edited_at=@now
  `).run({
    id: doc._id, slug: doc.slug, section: doc.section ?? "", headline: doc.headline ?? "",
    subheadline: doc.subheadline ?? "", byline: doc.byline ?? "", date: doc.date ?? "",
    status: doc.status ?? "draft", access: doc.access ?? "free",
    scheduledAt: doc.scheduledAt ?? null,
    body: JSON.stringify(doc.body ?? []),
    image: doc.image ? JSON.stringify(doc.image) : null,
    seoHeadline: doc.seoHeadline ?? null, socialHeadline: doc.socialHeadline ?? null,
    socialDescription: doc.socialDescription ?? null,
    readingTime: doc.readingTime ?? null, sortOrder: doc.sortOrder ?? null,
    now, lastEditedBy: doc.lastEditedBy ?? null,
  });
}

export function sqliteDeletePost(id: string): void {
  db().prepare(`DELETE FROM posts WHERE id = ?`).run(id);
}

export function sqliteSetStatus(id: string, status: string): void {
  db().prepare(`UPDATE posts SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
}

// --- Versions ---------------------------------------------------------------

export function sqliteSnapshotVersion(v: { slug: string; type: "autosave" | "publish"; headline: string; subheadline: string; body: unknown[]; wordCount: number; editedBy?: string }): void {
  const latest = db().prepare(`SELECT headline, subheadline, body FROM post_versions WHERE slug = ? ORDER BY saved_at DESC LIMIT 1`).get(v.slug);
  if (latest && latest.headline === v.headline && latest.subheadline === v.subheadline && latest.body === JSON.stringify(v.body)) return;
  db().prepare(`INSERT INTO post_versions (slug, type, saved_at, word_count, headline, subheadline, body, edited_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(v.slug, v.type, new Date().toISOString(), v.wordCount, v.headline, v.subheadline, JSON.stringify(v.body), v.editedBy ?? null);
  // Keep every publish; prune autosaves past 60.
  db().prepare(`
    DELETE FROM post_versions WHERE slug = ? AND type != 'publish' AND id NOT IN (
      SELECT id FROM post_versions WHERE slug = ? AND type != 'publish' ORDER BY saved_at DESC LIMIT 60
    )`).run(v.slug, v.slug);
}

export function sqliteGetVersions(slug: string): { _id: string; savedAt: string; type: "autosave" | "publish"; wordCount?: number; headline: string; subheadline: string; body: PortableTextBlock[]; editedBy?: string }[] {
  const rows = db().prepare(`SELECT * FROM post_versions WHERE slug = ? ORDER BY saved_at DESC`).all(slug);
  return rows.map((r: PostRow) => ({
    _id: String(r.id), savedAt: r.saved_at, type: r.type, wordCount: r.word_count ?? undefined,
    headline: r.headline, subheadline: r.subheadline, body: JSON.parse(r.body || "[]"),
    editedBy: r.edited_by ?? undefined,
  }));
}

// --- Singletons (about / welcome / lately) ----------------------------------

export function sqliteGetSingleton<T>(name: string): T | null {
  const row = db().prepare(`SELECT data FROM singletons WHERE name = ?`).get(name);
  return row ? (JSON.parse(row.data) as T) : null;
}

export function sqliteSetSingleton(name: string, data: unknown): void {
  db().prepare(`INSERT INTO singletons (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data`)
    .run(name, JSON.stringify(data));
}

// --- Generic documents (members, subscribers, users, newsletters, issues) ----

export type Doc = Record<string, unknown> & { _id: string; _type: string };

export function sqliteGetDoc<T = Doc>(id: string): T | null {
  const row = db().prepare(`SELECT id, type, data FROM documents WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...(JSON.parse(row.data) as Record<string, unknown>), _id: row.id, _type: row.type } as T;
}

export function sqliteDocsByType<T = Doc>(type: string): T[] {
  const rows = db().prepare(`SELECT id, type, data FROM documents WHERE type = ?`).all(type);
  return rows.map((r: PostRow) => ({ ...(JSON.parse(r.data) as Record<string, unknown>), _id: r.id, _type: r.type } as T));
}

function upsertDoc(doc: Doc, replace: boolean): void {
  const { _id, _type, ...data } = doc;
  if (!replace) {
    const exists = db().prepare(`SELECT 1 FROM documents WHERE id = ?`).get(_id);
    if (exists) return;
  }
  db().prepare(`INSERT INTO documents (id, type, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, data = excluded.data`)
    .run(_id, _type, JSON.stringify(data));
}

function patchDoc(id: string, set: Record<string, unknown>): void {
  const row = db().prepare(`SELECT data FROM documents WHERE id = ?`).get(id);
  if (row) {
    const data = { ...JSON.parse(row.data), ...set };
    db().prepare(`UPDATE documents SET data = ? WHERE id = ?`).run(JSON.stringify(data), id);
    return;
  }
  // Fall through to posts (fix-archive-style patches address post ids).
  const post = db().prepare(`SELECT id FROM posts WHERE id = ?`).get(id);
  if (post) {
    const COLS: Record<string, string> = {
      date: "date", byline: "byline", headline: "headline", subheadline: "subheadline",
      status: "status", access: "access", section: "section", sortOrder: "sort_order",
    };
    for (const [k, v] of Object.entries(set)) {
      if (COLS[k]) db().prepare(`UPDATE posts SET ${COLS[k]} = ? WHERE id = ?`).run(v as string | number, id);
    }
  }
}

// Sanity-mutation-shaped writes against the local store, so callers that build
// Sanity mutations (membership, users, newsletters) work unchanged. Posts are
// routed to the posts table; everything else lands in `documents`.
export function sqliteMutate(mutations: unknown[]): void {
  for (const m of mutations as Record<string, any>[]) {
    if (m.createOrReplace || m.createIfNotExists) {
      const doc = (m.createOrReplace ?? m.createIfNotExists) as Doc;
      if (doc._type === "post") {
        const replace = !!m.createOrReplace;
        const existing = db().prepare(`SELECT 1 FROM posts WHERE id = ?`).get(doc._id);
        if (existing && !replace) continue;
        const slug = (doc.slug as { current?: string })?.current ?? String(doc._id).replace(/^post-/, "");
        sqliteSavePost({
          _id: doc._id, slug,
          section: (doc.section as string) ?? "", headline: (doc.headline as string) ?? "",
          subheadline: (doc.subheadline as string) ?? "", byline: (doc.byline as string) ?? "",
          date: (doc.date as string) ?? "", status: (doc.status as string) ?? "draft",
          access: (doc.access as string) ?? "free",
          scheduledAt: (doc.scheduledAt as string) ?? null,
          body: doc.body ?? [],
          seoHeadline: (doc.seoHeadline as string) ?? null,
          socialHeadline: (doc.socialHeadline as string) ?? null,
          socialDescription: (doc.socialDescription as string) ?? null,
          readingTime: (doc.readingTime as number) ?? null,
          sortOrder: (doc.sortOrder as number) ?? null,
        });
      } else {
        upsertDoc(doc, !!m.createOrReplace);
      }
    } else if (m.patch) {
      patchDoc(m.patch.id as string, (m.patch.set ?? {}) as Record<string, unknown>);
    } else if (m.delete) {
      const id = m.delete.id as string;
      db().prepare(`DELETE FROM documents WHERE id = ?`).run(id);
      db().prepare(`DELETE FROM posts WHERE id = ?`).run(id);
    }
  }
}

// --- Media (uploads on local disk, served by /media/[...path]) ---------------

export function sqliteMediaDir(): string {
  const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sqliteSaveMedia(filename: string, buf: Buffer): { assetId: string; url: string } {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
  const name = `${Date.now()}-${safe}`;
  fs.writeFileSync(path.join(sqliteMediaDir(), name), buf);
  const url = `/media/${name}`;
  return { assetId: url, url };
}

export function sqliteListMedia(): { _id: string; _createdAt: string; url: string; originalFilename: string; size: number }[] {
  const dir = sqliteMediaDir();
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith("."))
    .map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { _id: `/media/${f}`, _createdAt: st.mtime.toISOString(), url: `/media/${f}`, originalFilename: f.replace(/^\d+-/, ""), size: st.size };
    })
    .sort((a, b) => b._createdAt.localeCompare(a._createdAt));
}

export function sqliteDeleteMedia(assetId: string): void {
  const name = assetId.replace(/^\/media\//, "");
  if (!name || name.includes("/") || name.includes("..")) return;
  try { fs.unlinkSync(path.join(sqliteMediaDir(), name)); } catch {}
}

// --- Comments ----------------------------------------------------------------

export type CommentRow = { _id: string; name: string; text: string; slug: string; approved: boolean; _createdAt: string };

export function sqliteAddComment(slug: string, name: string, text: string): void {
  const id = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db().prepare(`INSERT INTO documents (id, type, data) VALUES (?, 'comment', ?)`)
    .run(id, JSON.stringify({ slug, name, text, approved: true, _createdAt: new Date().toISOString() }));
}

export function sqliteCommentsForSlug(slug: string): CommentRow[] {
  return sqliteDocsByType<CommentRow>("comment")
    .filter(c => c.slug === slug && c.approved !== false)
    .sort((a, b) => (a._createdAt ?? "").localeCompare(b._createdAt ?? ""));
}

export function sqliteAllComments(): CommentRow[] {
  return sqliteDocsByType<CommentRow>("comment")
    .sort((a, b) => (b._createdAt ?? "").localeCompare(a._createdAt ?? ""));
}

export function sqliteDeleteComment(id: string): void {
  db().prepare(`DELETE FROM documents WHERE id = ? AND type = 'comment'`).run(id);
}
