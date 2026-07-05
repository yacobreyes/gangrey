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
      body TEXT DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_versions_slug ON post_versions (slug, saved_at DESC);

    CREATE TABLE IF NOT EXISTS singletons (
      name TEXT PRIMARY KEY,
      data TEXT NOT NULL                 -- JSON blob (about, welcome, lately)
    );
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

export function sqliteSnapshotVersion(v: { slug: string; type: "autosave" | "publish"; headline: string; subheadline: string; body: unknown[]; wordCount: number }): void {
  const latest = db().prepare(`SELECT headline, subheadline, body FROM post_versions WHERE slug = ? ORDER BY saved_at DESC LIMIT 1`).get(v.slug);
  if (latest && latest.headline === v.headline && latest.subheadline === v.subheadline && latest.body === JSON.stringify(v.body)) return;
  db().prepare(`INSERT INTO post_versions (slug, type, saved_at, word_count, headline, subheadline, body) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(v.slug, v.type, new Date().toISOString(), v.wordCount, v.headline, v.subheadline, JSON.stringify(v.body));
  // Keep every publish; prune autosaves past 60.
  db().prepare(`
    DELETE FROM post_versions WHERE slug = ? AND type != 'publish' AND id NOT IN (
      SELECT id FROM post_versions WHERE slug = ? AND type != 'publish' ORDER BY saved_at DESC LIMIT 60
    )`).run(v.slug, v.slug);
}

export function sqliteGetVersions(slug: string): { _id: string; savedAt: string; type: "autosave" | "publish"; wordCount?: number; headline: string; subheadline: string; body: PortableTextBlock[] }[] {
  const rows = db().prepare(`SELECT * FROM post_versions WHERE slug = ? ORDER BY saved_at DESC`).all(slug);
  return rows.map((r: PostRow) => ({
    _id: String(r.id), savedAt: r.saved_at, type: r.type, wordCount: r.word_count ?? undefined,
    headline: r.headline, subheadline: r.subheadline, body: JSON.parse(r.body || "[]"),
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
