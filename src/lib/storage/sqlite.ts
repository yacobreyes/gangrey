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
  // SQLite is the only backend. Gangrey migrated off Sanity in July 2026; this
  // flag is hardcoded (rather than reading STORAGE_BACKEND) so a missing env
  // var can never silently route a write to the removed Sanity path again —
  // that failure mode broke "Create story draft", the leaderboard, and email
  // open tracking before the migration was finished.
  return true;
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

    -- Analytics event log (the Parse.ly-style engine). Append-only; one row per
    -- pageview and per engagement heartbeat. Cookieless: 'session' is an
    -- ephemeral per-tab id, no PII stored.
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,               -- epoch ms
      kind TEXT NOT NULL,                -- 'view' | 'engage'
      slug TEXT,
      section TEXT DEFAULT '',
      byline TEXT DEFAULT '',
      ref_host TEXT DEFAULT '',          -- referrer hostname ('' = direct/internal)
      source TEXT DEFAULT 'Direct',      -- categorized channel
      device TEXT DEFAULT 'desktop',     -- mobile | tablet | desktop
      session TEXT DEFAULT '',           -- ephemeral per-tab id
      engaged_ms INTEGER DEFAULT 0       -- active reading time this heartbeat
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON analytics_events (ts);
    CREATE INDEX IF NOT EXISTS idx_events_slug_ts ON analytics_events (slug, ts);
    CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON analytics_events (kind, ts);
  `);

  // Additive column migrations — CREATE TABLE IF NOT EXISTS never alters an
  // existing table, so columns added after a database was first created must be
  // backfilled here. (Adding `edited_by` in a later release is why publishing
  // — which always snapshots a version — began failing on older databases.)
  ensureColumn(d, "post_versions", "edited_by", "TEXT");
  // Homepage pins. pinned_hero: at most one, becomes the big hero. pinned_top:
  // any number, forced into the Top Stories row (before auto-filled recents).
  ensureColumn(d, "posts", "pinned_hero", "INTEGER DEFAULT 0");
  ensureColumn(d, "posts", "pinned_top", "INTEGER DEFAULT 0");
  // Per-story override to let an individual Archive post out of the paywall.
  ensureColumn(d, "posts", "archive_free", "INTEGER DEFAULT 0");
}

function ensureColumn(d: any, table: string, col: string, decl: string) {
  const cols: { name: string }[] = d.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === col)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  }
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
    image: image ? { asset: undefined as any, url: image.src, caption: image.caption, alt: image.alt, crops: image.crops } : undefined,
    seoHeadline: r.seo_headline ?? undefined,
    socialHeadline: r.social_headline ?? undefined,
    socialDescription: r.social_description ?? undefined,
    readingTime: r.reading_time ?? undefined,
    sortOrder: r.sort_order ?? undefined,
    _createdAt: r.created_at ?? undefined,
    _updatedAt: r.updated_at ?? undefined,
    lastEditedBy: r.last_edited_by ?? undefined,
    lastEditedAt: r.last_edited_at ?? undefined,
    pinnedHero: !!r.pinned_hero,
    pinnedTop: !!r.pinned_top,
    archiveFree: !!r.archive_free,
  };
}

// pinned_hero is single (pinning one clears any other). pinned_top is a plain
// toggle — any number of posts can be pinned into the Top Stories row.
export function sqliteSetPins(id: string, hero: boolean, top: boolean): void {
  if (hero) {
    db().prepare(`UPDATE posts SET pinned_hero = 0 WHERE pinned_hero = 1 AND id != ?`).run(id);
    db().prepare(`UPDATE posts SET pinned_hero = 1 WHERE id = ?`).run(id);
  } else {
    db().prepare(`UPDATE posts SET pinned_hero = 0 WHERE id = ?`).run(id);
  }
  db().prepare(`UPDATE posts SET pinned_top = ? WHERE id = ?`).run(top ? 1 : 0, id);
}

export function sqliteSetArchiveFree(id: string, on: boolean): void {
  db().prepare(`UPDATE posts SET archive_free = ? WHERE id = ?`).run(on ? 1 : 0, id);
}

// Correct an imported archive post's publish date and/or byline (the Wayback
// harvest fixes). Only writes the fields provided, so passing a date without a
// byline leaves the byline untouched. Also stamps updated_at.
export function sqliteSetDateByline(id: string, date?: string, byline?: string): void {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (date !== undefined) { sets.push("date = ?"); vals.push(date); }
  if (byline !== undefined) { sets.push("byline = ?"); vals.push(byline); }
  if (!sets.length) return;
  sets.push("updated_at = ?"); vals.push(new Date().toISOString());
  db().prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

// Every archive post id + its current date/byline, for the fixes apply pass.
export function sqliteArchivePostsForFixes(): { id: string; slug: string; headline: string; date: string; byline: string }[] {
  const rows = db().prepare(
    `SELECT id, slug, headline, date, byline FROM posts WHERE section = 'Archive'`
  ).all() as Record<string, unknown>[];
  return rows.map(r => ({
    id: String(r.id), slug: String(r.slug ?? ""), headline: String(r.headline ?? ""),
    date: String(r.date ?? ""), byline: String(r.byline ?? ""),
  }));
}

// Current slug for a post id (null if none) — used to detect slug renames.
export function sqliteSlugForId(id: string): string | null {
  const row = db().prepare(`SELECT slug FROM posts WHERE id = ?`).get(id);
  return row ? String(row.slug) : null;
}

// When a post's slug changes, everything keyed by slug — analytics events,
// view/like/read counters, comments — must move with it, or it's orphaned
// (stale analytics rows that 404, lost view counts). Re-point them all.
export function sqliteRenameSlugData(oldSlug: string, newSlug: string): void {
  if (!oldSlug || oldSlug === newSlug) return;
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9-_]/g, "-");
  db().prepare(`UPDATE analytics_events SET slug = ? WHERE slug = ?`).run(newSlug, oldSlug);
  // Counters are documents with id `<kind>-<safe(slug)>`.
  for (const kind of ["views", "likes", "reads"]) {
    const oldId = `${kind}-${safe(oldSlug)}`, newId = `${kind}-${safe(newSlug)}`;
    const row = db().prepare(`SELECT data FROM documents WHERE id = ? AND type = 'counter'`).get(oldId);
    if (row) {
      db().prepare(`INSERT INTO documents (id, type, data) VALUES (?, 'counter', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(newId, row.data);
      db().prepare(`DELETE FROM documents WHERE id = ?`).run(oldId);
    }
  }
  // Comments carry the slug inside their JSON payload.
  const comments = db().prepare(`SELECT id, data FROM documents WHERE type = 'comment'`).all();
  for (const c of comments) {
    try {
      const d = JSON.parse(c.data);
      if (d.slug === oldSlug) { d.slug = newSlug; db().prepare(`UPDATE documents SET data = ? WHERE id = ?`).run(JSON.stringify(d), c.id); }
    } catch { /* skip */ }
  }
}

const PUBLIC_WHERE = `status != 'trashed' AND (
  status = 'published' OR status IS NULL OR status = '' OR
  (status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now'))
)`;

export function sqliteAllPublishedPosts(): SanityPost[] {
  const rows = db().prepare(`SELECT * FROM posts WHERE ${PUBLIC_WHERE} ORDER BY date DESC, COALESCE(sort_order, 0) ASC`).all();
  return rows.map(rowToPost);
}

// Every column EXCEPT the portable-text body. With the ~2,500-story archive
// imported, `SELECT *` + JSON.parse of every body costs real time per request
// and, worse, ships megabytes to the browser when a list feeds a client
// component. List/index contexts (homepage, latest, related, slugs, admin
// tables) must use these; only single-post reads need the body.
const LIGHT_COLS = `id, slug, section, headline, subheadline, byline, date, status, access,
  scheduled_at, image, seo_headline, social_headline, social_description,
  reading_time, sort_order, created_at, updated_at, last_edited_by, last_edited_at,
  pinned_hero, pinned_top, archive_free`;

export function sqliteAllPublishedPostsLight(): SanityPost[] {
  const rows = db().prepare(`SELECT ${LIGHT_COLS} FROM posts WHERE ${PUBLIC_WHERE} ORDER BY date DESC, COALESCE(sort_order, 0) ASC`).all();
  return rows.map((r: PostRow) => rowToPost({ ...r, body: "[]" }));
}

export function sqliteAllPostsAdminLight(excludeArchive = false): SanityPost[] {
  const where = excludeArchive ? `WHERE section != 'Archive'` : "";
  const rows = db().prepare(`SELECT ${LIGHT_COLS} FROM posts ${where} ORDER BY COALESCE(updated_at, created_at) DESC`).all();
  return rows.map((r: PostRow) => rowToPost({ ...r, body: "[]" }));
}

// slug -> plain body text, for client-side search. Parses bodies, so only call
// when a search actually needs it (?q=), never on plain page loads.
// section: restrict to one section (e.g. "Archive") so callers building a
// section list don't pay to parse every published post site-wide. maxChars
// caps how much of each body gets decoded — list views only ever show a
// short excerpt, so there's no reason to walk (and allocate) the full text
// of a multi-thousand-word story for each of thousands of rows.
export function sqliteBodyTextBySlug(publishedOnly = true, section?: string, maxChars = 400): Record<string, string> {
  const clauses = [publishedOnly ? PUBLIC_WHERE : null, section ? `section = @section` : null].filter(Boolean);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db().prepare(`SELECT slug, body FROM posts ${where}`).all({ section });
  const out: Record<string, string> = {};
  for (const r of rows) {
    try {
      const blocks = JSON.parse(r.body || "[]") as { _type?: string; children?: { text?: string }[] }[];
      let text = "";
      for (const b of blocks) {
        if (b._type !== "block") continue;
        for (const c of b.children ?? []) {
          text += (text ? " " : "") + (c.text ?? "");
          if (text.length >= maxChars) break;
        }
        if (text.length >= maxChars) break;
      }
      out[r.slug] = text;
    } catch { out[r.slug] = ""; }
  }
  return out;
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
  scheduledAt?: string | null; body: unknown; image?: { src: string; caption?: string; alt?: string; crops?: unknown } | null;
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

// Full archive rebuild: wipe every Archive/Gangrey-Redux post and re-insert the
// clean dataset in one transaction. Returns {deleted, inserted}. Each record is
// keyed by its real WordPress post id, so headline/date/byline/body all agree.
export function sqliteReplaceArchive(
  records: { slug: string; headline: string; subheadline?: string; byline: string; date: string; readingTime?: number; body: unknown }[]
): { deleted: number; inserted: number } {
  const d = db();
  const now = new Date().toISOString();
  const del = d.prepare(`DELETE FROM posts WHERE section IN ('Archive', 'Gangrey Redux')`);
  const ins = d.prepare(`
    INSERT INTO posts (id, slug, section, headline, subheadline, byline, date, status, access,
      body, reading_time, created_at, updated_at)
    VALUES (@id, @slug, 'Archive', @headline, @subheadline, @byline, @date, 'published', 'paid',
      @body, @reading_time, @now, @now)`);
  const tx = d.transaction((rows: typeof records) => {
    const deleted = del.run().changes;
    let inserted = 0;
    for (const r of rows) {
      ins.run({
        id: `gangrey-import-${r.slug}`, slug: r.slug, headline: r.headline ?? "", subheadline: r.subheadline ?? "",
        byline: r.byline ?? "", date: r.date ?? "", body: JSON.stringify(r.body ?? []),
        reading_time: r.readingTime ?? null, now,
      });
      inserted++;
    }
    return { deleted, inserted };
  });
  return tx(records);
}

export function sqliteSetStatus(id: string, status: string): void {
  db().prepare(`UPDATE posts SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
}

// --- Versions ---------------------------------------------------------------

export function sqliteSnapshotVersion(v: { slug: string; type: "autosave" | "publish"; headline: string; subheadline: string; body: unknown[]; wordCount: number; editedBy?: string }): void {
  // Best-effort: version history must never block (or fail) an actual save.
  try {
    const latest = db().prepare(`SELECT headline, subheadline, body FROM post_versions WHERE slug = ? ORDER BY saved_at DESC LIMIT 1`).get(v.slug);
    if (latest && latest.headline === v.headline && latest.subheadline === v.subheadline && latest.body === JSON.stringify(v.body)) return;
    db().prepare(`INSERT INTO post_versions (slug, type, saved_at, word_count, headline, subheadline, body, edited_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(v.slug, v.type, new Date().toISOString(), v.wordCount, v.headline, v.subheadline, JSON.stringify(v.body), v.editedBy ?? null);
    // Keep every publish; prune autosaves past 60.
    db().prepare(`
      DELETE FROM post_versions WHERE slug = ? AND type != 'publish' AND id NOT IN (
        SELECT id FROM post_versions WHERE slug = ? AND type != 'publish' ORDER BY saved_at DESC LIMIT 60
      )`).run(v.slug, v.slug);
  } catch (err) {
    console.error("sqliteSnapshotVersion failed", err);
  }
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
        // Sanity-shaped image ref → the sqlite image shape. On this backend the
        // asset "ref" is the /media/... URL itself.
        const img = doc.image as { asset?: { _ref?: string }; caption?: string; alt?: string } | undefined;
        sqliteSavePost({
          _id: doc._id, slug,
          section: (doc.section as string) ?? "", headline: (doc.headline as string) ?? "",
          subheadline: (doc.subheadline as string) ?? "", byline: (doc.byline as string) ?? "",
          date: (doc.date as string) ?? "", status: (doc.status as string) ?? "draft",
          access: (doc.access as string) ?? "free",
          scheduledAt: (doc.scheduledAt as string) ?? null,
          body: doc.body ?? [],
          image: img?.asset?._ref ? { src: img.asset._ref, caption: img.caption, alt: img.alt } : null,
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

// Per-asset metadata (title/caption/alt text) — media files themselves are
// just bytes on disk with no room for this, so it's kept alongside in the
// generic documents table, keyed by the asset's /media/... path.
export function sqliteGetMediaMeta(assetId: string): { title?: string; description?: string; altText?: string } {
  const row = db().prepare(`SELECT data FROM documents WHERE id = ? AND type = 'mediaMeta'`).get(assetId);
  return row ? JSON.parse(row.data) : {};
}

export function sqliteSetMediaMeta(assetId: string, fields: { title?: string; description?: string; altText?: string }): void {
  const existing = sqliteGetMediaMeta(assetId);
  const merged = { ...existing, ...fields };
  db().prepare(`INSERT INTO documents (id, type, data) VALUES (?, 'mediaMeta', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
    .run(assetId, JSON.stringify(merged));
}

// --- Comments ----------------------------------------------------------------

export type CommentRow = { _id: string; name: string; email?: string; text: string; slug: string; approved: boolean; _createdAt: string };

export function sqliteAddComment(slug: string, name: string, text: string, email = ""): void {
  const id = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Arrives pending (approved: false) — an admin must approve it before it shows
  // publicly. sqliteCommentsForSlug filters on approved. Email is stored for the
  // admin only, never returned to the public comment feed.
  db().prepare(`INSERT INTO documents (id, type, data) VALUES (?, 'comment', ?)`)
    .run(id, JSON.stringify({ slug, name, email, text, approved: false, _createdAt: new Date().toISOString() }));
}

export function sqliteSetCommentApproved(id: string, approved: boolean): void {
  const row = db().prepare(`SELECT data FROM documents WHERE id = ? AND type = 'comment'`).get(id);
  if (!row) return;
  const data = { ...JSON.parse(row.data), approved };
  db().prepare(`UPDATE documents SET data = ? WHERE id = ? AND type = 'comment'`).run(JSON.stringify(data), id);
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

// --- Submissions -------------------------------------------------------------

export type SubmissionStatus = "new" | "reading" | "accepted" | "declined";
export type SubmissionRow = {
  _id: string;
  name: string;
  email: string;
  title: string;
  category: string;
  coverLetter?: string;
  text: string;
  wordCount: number;
  status: SubmissionStatus;
  respondedAt?: string;
  _createdAt: string;
};

export function sqliteAddSubmission(data: Omit<SubmissionRow, "_id" | "status" | "_createdAt">): SubmissionRow {
  const id = `submission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const doc: SubmissionRow = { ...data, _id: id, status: "new", _createdAt: new Date().toISOString() };
  const { _id, ...rest } = doc;
  db().prepare(`INSERT INTO documents (id, type, data) VALUES (?, 'submission', ?)`).run(_id, JSON.stringify(rest));
  return doc;
}

export function sqliteAllSubmissions(): SubmissionRow[] {
  return sqliteDocsByType<SubmissionRow>("submission")
    .sort((a, b) => (b._createdAt ?? "").localeCompare(a._createdAt ?? ""));
}

export function sqliteGetSubmission(id: string): SubmissionRow | null {
  const row = db().prepare(`SELECT id, data FROM documents WHERE id = ? AND type = 'submission'`).get(id);
  return row ? { _id: row.id, ...JSON.parse(row.data) } as SubmissionRow : null;
}

export function sqliteUpdateSubmission(id: string, patch: Partial<SubmissionRow>): void {
  const row = db().prepare(`SELECT data FROM documents WHERE id = ? AND type = 'submission'`).get(id);
  if (!row) return;
  const { _id: _ignore, ...clean } = patch as Partial<SubmissionRow> & { _id?: string };
  const data = { ...JSON.parse(row.data), ...clean };
  db().prepare(`UPDATE documents SET data = ? WHERE id = ? AND type = 'submission'`).run(JSON.stringify(data), id);
}

export function sqliteDeleteSubmission(id: string): void {
  db().prepare(`DELETE FROM documents WHERE id = ? AND type = 'submission'`).run(id);
}

// --- Counters (likes, reads) -------------------------------------------------

export function sqliteGetCount(id: string): number {
  const row = db().prepare(`SELECT data FROM documents WHERE id = ? AND type = 'counter'`).get(id);
  return row ? (JSON.parse(row.data).count ?? 0) : 0;
}

export function sqliteIncrementCount(id: string, delta: number): number {
  const next = Math.max(0, sqliteGetCount(id) + delta);
  db().prepare(`INSERT INTO documents (id, type, data) VALUES (?, 'counter', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
    .run(id, JSON.stringify({ count: next }));
  return next;
}

// Map of slug -> view count, for the admin dashboard. View counters are stored
// with id `views-<slug>`.
export function sqliteAllViewCounts(): Record<string, number> {
  const rows = db().prepare(`SELECT id, data FROM documents WHERE type = 'counter' AND id LIKE 'views-%'`).all();
  const out: Record<string, number> = {};
  for (const r of rows) out[r.id.slice("views-".length)] = JSON.parse(r.data).count ?? 0;
  return out;
}

// --- Analytics engine (Parse.ly-style) --------------------------------------

export type AnalyticsEvent = {
  ts: number; kind: "view" | "engage"; slug: string;
  section?: string; byline?: string; ref_host?: string; source?: string;
  device?: string; session?: string; engaged_ms?: number;
};

export function sqliteRecordEvent(e: AnalyticsEvent): void {
  db().prepare(`INSERT INTO analytics_events
    (ts, kind, slug, section, byline, ref_host, source, device, session, engaged_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(e.ts, e.kind, e.slug, e.section ?? "", e.byline ?? "", e.ref_host ?? "",
         e.source ?? "Direct", e.device ?? "desktop", e.session ?? "", e.engaged_ms ?? 0);
}

// Prune events older than `days` so the table doesn't grow unbounded (all-time
// totals live in the counters). Called opportunistically from the track route.
export function sqlitePruneEvents(days = 365): void {
  const cutoff = Date.now() - days * 86400_000;
  db().prepare(`DELETE FROM analytics_events WHERE ts < ?`).run(cutoff);
}

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

// Headline KPIs over [since, until): views, unique visitors, total + average
// engaged time (ms). Engaged time is summed from 'engage' heartbeats.
export function sqliteAnalyticsOverview(since: number, until: number): {
  views: number; visitors: number; engagedMs: number; avgEngagedMs: number;
} {
  const v = db().prepare(`SELECT COUNT(*) c, COUNT(DISTINCT session) u FROM analytics_events WHERE kind='view' AND ts>=? AND ts<?`).get(since, until) as Row;
  const e = db().prepare(`SELECT COALESCE(SUM(engaged_ms),0) s FROM analytics_events WHERE kind='engage' AND ts>=? AND ts<?`).get(since, until) as Row;
  const views = num(v.c), engagedMs = num(e.s);
  return { views, visitors: num(v.u), engagedMs, avgEngagedMs: views ? Math.round(engagedMs / views) : 0 };
}

// View counts bucketed into `buckets` equal time slices across [since, until) —
// for the time-series chart.
export function sqliteAnalyticsSeries(since: number, until: number, buckets: number): number[] {
  const span = Math.max(1, until - since);
  const width = span / buckets;
  const rows = db().prepare(`SELECT ts FROM analytics_events WHERE kind='view' AND ts>=? AND ts<?`).all(since, until) as Row[];
  const out = new Array(buckets).fill(0);
  for (const r of rows) {
    const i = Math.min(buckets - 1, Math.floor((num(r.ts) - since) / width));
    out[i]++;
  }
  return out;
}

// Top stories by views (with visitors + avg engaged time) in the window.
export function sqliteAnalyticsTopContent(since: number, until: number, limit = 20): {
  slug: string; section: string; byline: string; views: number; visitors: number; avgEngagedMs: number;
}[] {
  const views = db().prepare(`
    SELECT slug, section, byline, COUNT(*) v, COUNT(DISTINCT session) u
    FROM analytics_events WHERE kind='view' AND ts>=? AND ts<? AND slug != ''
    GROUP BY slug ORDER BY v DESC LIMIT ?`).all(since, until, limit) as Row[];
  const eng = db().prepare(`
    SELECT slug, COALESCE(SUM(engaged_ms),0) e FROM analytics_events
    WHERE kind='engage' AND ts>=? AND ts<? GROUP BY slug`).all(since, until) as Row[];
  const engBySlug = new Map(eng.map(r => [String(r.slug), num(r.e)]));
  return views.map(r => {
    const v = num(r.v);
    return {
      slug: String(r.slug), section: String(r.section ?? ""), byline: String(r.byline ?? ""),
      views: v, visitors: num(r.u),
      avgEngagedMs: v ? Math.round((engBySlug.get(String(r.slug)) ?? 0) / v) : 0,
    };
  });
}

// Generic "views grouped by <column>" for referrers/sources/sections/authors/device.
export function sqliteAnalyticsBreakdown(column: "source" | "section" | "byline" | "device" | "ref_host", since: number, until: number, limit = 12): { key: string; views: number }[] {
  const rows = db().prepare(
    `SELECT ${column} k, COUNT(*) v FROM analytics_events
     WHERE kind='view' AND ts>=? AND ts<? GROUP BY ${column} ORDER BY v DESC LIMIT ?`
  ).all(since, until, limit) as Row[];
  return rows.map(r => ({ key: String(r.k ?? "") || "—", views: num(r.v) }));
}

// Real-time: distinct sessions active in the last `windowMs`, plus what each is
// reading (most recent view per active session).
export function sqliteAnalyticsRealtime(windowMs = 5 * 60_000): { active: number; reading: { slug: string; views: number }[] } {
  const since = Date.now() - windowMs;
  const a = db().prepare(`SELECT COUNT(DISTINCT session) u FROM analytics_events WHERE ts>=?`).get(since) as Row;
  const reading = db().prepare(`
    SELECT slug, COUNT(DISTINCT session) views FROM analytics_events
    WHERE kind='view' AND ts>=? AND slug != '' GROUP BY slug ORDER BY views DESC LIMIT 10`).all(since) as Row[];
  return { active: num(a.u), reading: reading.map(r => ({ slug: String(r.slug), views: num(r.views) })) };
}

// Trending: stories whose recent view velocity most exceeds their prior baseline
// — surfaces what's heating up, not just what's all-time popular.
export function sqliteAnalyticsTrending(limit = 10): { slug: string; recent: number; score: number }[] {
  const now = Date.now();
  const recentSince = now - 3 * 3600_000;      // last 3h
  const baseSince = now - 27 * 3600_000;       // prior 24h before that
  const recent = db().prepare(`SELECT slug, COUNT(*) v FROM analytics_events WHERE kind='view' AND ts>=? AND slug!='' GROUP BY slug`).all(recentSince) as Row[];
  const base = db().prepare(`SELECT slug, COUNT(*) v FROM analytics_events WHERE kind='view' AND ts>=? AND ts<? AND slug!='' GROUP BY slug`).all(baseSince, recentSince) as Row[];
  const baseRate = new Map(base.map(r => [String(r.slug), num(r.v) / 24])); // per-hour baseline
  const scored = recent.map(r => {
    const slug = String(r.slug), rec = num(r.v);
    const recRate = rec / 3;
    const bl = baseRate.get(slug) ?? 0;
    // Velocity lift over baseline; +1 smoothing so brand-new stories can trend.
    return { slug, recent: rec, score: recRate / (bl + 0.5) };
  });
  return scored.filter(s => s.recent >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
}
