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

    -- Old story URLs → their current slug, so renaming a slug 301s the old
    -- link instead of 404ing (preserves inbound links and search rankings).
    CREATE TABLE IF NOT EXISTS slug_redirects (
      from_slug TEXT PRIMARY KEY,
      to_slug   TEXT NOT NULL,
      created_at TEXT
    );

    -- Metered paywall: which members-only stories an anonymous visitor
    -- (identified by a first-party 'gm_id' cookie) has read in a given month.
    -- Distinct (meter_id, slug, month) rows = free reads used that month.
    CREATE TABLE IF NOT EXISTS meter_reads (
      meter_id TEXT NOT NULL,
      slug     TEXT NOT NULL,
      month    TEXT NOT NULL,          -- 'YYYY-MM' (ET)
      ts       INTEGER NOT NULL,
      PRIMARY KEY (meter_id, slug, month)
    );
    CREATE INDEX IF NOT EXISTS idx_meter_month ON meter_reads (month, meter_id);
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
  // Who scheduled a scheduled story — shown in the editor's view-mode banner
  // ("This story was scheduled by X for ..."). Cleared when unscheduled.
  ensureColumn(d, "posts", "scheduled_by", "TEXT");
  // The moment a story first went live — captured once, never overwritten by
  // later edits (unlike last_edited_at). Powers the editor's "published on X"
  // banner with the real publish time.
  ensureColumn(d, "posts", "published_at", "TEXT");
  // Editorial workflow: which pipeline stage a draft is in, and the editor it's
  // assigned to — powers the Calendar/board. Existing drafts read 'drafting'.
  ensureColumn(d, "posts", "stage", "TEXT DEFAULT 'drafting'");
  ensureColumn(d, "posts", "assignee", "TEXT");
  // Data fix: analytics events snapshot the byline at view time, and views
  // recorded before the archive byline cleanup carry the old short poster
  // names. The breakdown now groups by the post's current byline, but events
  // whose slug no longer exists keep their snapshot — rewrite the known
  // renames so "Ben" can't linger beside "Ben Montgomery". Idempotent.
  try {
    d.prepare(`UPDATE analytics_events SET byline='Ben Montgomery' WHERE byline IN ('Ben','ben')`).run();
    d.prepare(`UPDATE analytics_events SET byline='Thomas Lake' WHERE byline IN ('t lake','T Lake','t. lake')`).run();
    d.prepare(`UPDATE analytics_events SET byline='Michael Kruse' WHERE byline IN ('kruse','Kruse')`).run();
  } catch { /* best-effort */ }

  // Full-text search index over every post (headline/subheadline/byline/section
  // + flattened body). Standalone FTS5 table kept in sync on write; backfilled
  // once here so the ~3,100-piece archive is searchable server-side instead of
  // client-filtering the whole list.
  try {
    d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
      id UNINDEXED, slug UNINDEXED, section, byline, headline, subheadline, body,
      tokenize = 'porter unicode61'
    );`);
    const ftsCount = (d.prepare(`SELECT COUNT(*) c FROM posts_fts`).get() as { c: number }).c;
    const postCount = (d.prepare(`SELECT COUNT(*) c FROM posts`).get() as { c: number }).c;
    if (ftsCount === 0 && postCount > 0) ftsReindexAll(d);
  } catch { /* FTS5 unavailable — search falls back to LIKE via sqliteSearchPosts */ }
}

// Flatten Portable Text blocks to plain text for the search index.
function ptToText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return (body as { _type?: string; children?: { text?: string }[] }[])
    .filter(b => b?._type === "block" || Array.isArray(b?.children))
    .flatMap(b => (b.children ?? []).map(c => c.text ?? ""))
    .join(" ").replace(/\s+/g, " ").trim();
}

function ftsHasTable(d: any): boolean {
  try { return !!d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts_fts'`).get(); }
  catch { return false; }
}

// Reindex a single post (delete + insert), keeping FTS in step with a write.
function ftsUpsert(d: any, row: { id: string; slug: string; section?: string; byline?: string; headline?: string; subheadline?: string; body?: unknown }) {
  if (!ftsHasTable(d)) return;
  try {
    d.prepare(`DELETE FROM posts_fts WHERE id = ?`).run(row.id);
    d.prepare(`INSERT INTO posts_fts (id, slug, section, byline, headline, subheadline, body) VALUES (?,?,?,?,?,?,?)`)
      .run(row.id, row.slug, row.section ?? "", row.byline ?? "", row.headline ?? "", row.subheadline ?? "", ptToText(row.body));
  } catch { /* best-effort */ }
}
function ftsRemove(d: any, id: string) {
  if (!ftsHasTable(d)) return;
  try { d.prepare(`DELETE FROM posts_fts WHERE id = ?`).run(id); } catch { /* best-effort */ }
}
function ftsReindexAll(d: any) {
  if (!ftsHasTable(d)) return;
  const rows = d.prepare(`SELECT id, slug, section, byline, headline, subheadline, body FROM posts`).all();
  const ins = d.prepare(`INSERT INTO posts_fts (id, slug, section, byline, headline, subheadline, body) VALUES (?,?,?,?,?,?,?)`);
  const tx = d.transaction((rs: any[]) => {
    d.prepare(`DELETE FROM posts_fts`).run();
    for (const r of rs) {
      let body: unknown = [];
      try { body = JSON.parse(r.body || "[]"); } catch {}
      ins.run(r.id, r.slug, r.section ?? "", r.byline ?? "", r.headline ?? "", r.subheadline ?? "", ptToText(body));
    }
  });
  tx(rows);
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
    scheduledBy: r.scheduled_by ?? undefined,
    publishedAt: r.published_at ?? undefined,
    stage: r.stage ?? undefined,
    assignee: r.assignee ?? undefined,
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
// Record that oldSlug now lives at newSlug (301). Collapses chains so an old
// URL always points straight at the current slug, never through a hop.
export function sqliteAddSlugRedirect(oldSlug: string, newSlug: string): void {
  if (!oldSlug || oldSlug === newSlug) return;
  const now = new Date().toISOString();
  const d = db();
  // Any redirect that pointed at the old slug should now point at the new one.
  d.prepare(`UPDATE slug_redirects SET to_slug = ?, created_at = ? WHERE to_slug = ?`).run(newSlug, now, oldSlug);
  // The old slug now redirects forward…
  d.prepare(`INSERT INTO slug_redirects (from_slug, to_slug, created_at) VALUES (?, ?, ?)
             ON CONFLICT(from_slug) DO UPDATE SET to_slug = excluded.to_slug, created_at = excluded.created_at`).run(oldSlug, newSlug, now);
  // …and the new slug must not itself redirect (it's live now).
  d.prepare(`DELETE FROM slug_redirects WHERE from_slug = ?`).run(newSlug);
}

// The current slug an old URL should 301 to, or null if there's no redirect.
export function sqliteRedirectTarget(slug: string): string | null {
  if (!slug) return null;
  const row = db().prepare(`SELECT to_slug FROM slug_redirects WHERE from_slug = ?`).get(slug) as { to_slug?: string } | undefined;
  return row?.to_slug ?? null;
}

// --- Metered paywall -------------------------------------------------------

// Free members-only stories this visitor has already opened this month.
export function sqliteMeterCount(meterId: string, month: string): number {
  if (!meterId) return 0;
  const r = db().prepare(`SELECT COUNT(*) c FROM meter_reads WHERE meter_id = ? AND month = ?`).get(meterId, month) as { c: number };
  return r.c;
}
// Has this visitor already opened THIS story this month (so re-reads don't re-wall)?
export function sqliteMeterHasRead(meterId: string, slug: string, month: string): boolean {
  if (!meterId) return false;
  return !!db().prepare(`SELECT 1 FROM meter_reads WHERE meter_id = ? AND slug = ? AND month = ?`).get(meterId, slug, month);
}
// Record a metered read (idempotent per visitor/story/month).
export function sqliteRecordMeterRead(meterId: string, slug: string, month: string): void {
  if (!meterId || !slug) return;
  db().prepare(`INSERT OR IGNORE INTO meter_reads (meter_id, slug, month, ts) VALUES (?, ?, ?, ?)`).run(meterId, slug, month, Date.now());
}
// Funnel for a month: how many visitors sampled a gated story, and how many
// hit the wall (used up all `limit` free reads).
export function sqliteMeterFunnel(month: string, limit: number): { readers: number; walled: number } {
  const readers = (db().prepare(`SELECT COUNT(DISTINCT meter_id) c FROM meter_reads WHERE month = ?`).get(month) as { c: number }).c;
  const walled = (db().prepare(`SELECT COUNT(*) c FROM (SELECT meter_id FROM meter_reads WHERE month = ? GROUP BY meter_id HAVING COUNT(*) >= ?)`).get(month, limit) as { c: number }).c;
  return { readers, walled };
}

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
  pinned_hero, pinned_top, archive_free, stage, assignee`;

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
  scheduledAt?: string | null; scheduledBy?: string | null; body: unknown; image?: { src: string; caption?: string; alt?: string; crops?: unknown } | null;
  seoHeadline?: string | null; socialHeadline?: string | null; socialDescription?: string | null;
  readingTime?: number | null; sortOrder?: number | null; lastEditedBy?: string;
}): void {
  const now = new Date().toISOString();
  db().prepare(`
    INSERT INTO posts (id, slug, section, headline, subheadline, byline, date, status, access,
      scheduled_at, scheduled_by, body, image, seo_headline, social_headline, social_description,
      reading_time, sort_order, created_at, updated_at, last_edited_by, last_edited_at, published_at)
    VALUES (@id, @slug, @section, @headline, @subheadline, @byline, @date, @status, @access,
      @scheduledAt, @scheduledBy, @body, @image, @seoHeadline, @socialHeadline, @socialDescription,
      @readingTime, @sortOrder, @now, @now, @lastEditedBy, @now, @publishedAt)
    ON CONFLICT(id) DO UPDATE SET
      slug=@slug, section=@section, headline=@headline, subheadline=@subheadline,
      byline=@byline, date=@date, status=@status, access=@access, scheduled_at=@scheduledAt, scheduled_by=@scheduledBy,
      body=@body, image=@image, seo_headline=@seoHeadline, social_headline=@socialHeadline,
      social_description=@socialDescription, reading_time=@readingTime, sort_order=@sortOrder,
      updated_at=@now, last_edited_by=@lastEditedBy, last_edited_at=@now,
      published_at=CASE WHEN @status='published' THEN COALESCE(published_at, @now) ELSE published_at END
  `).run({
    id: doc._id, slug: doc.slug, section: doc.section ?? "", headline: doc.headline ?? "",
    subheadline: doc.subheadline ?? "", byline: doc.byline ?? "", date: doc.date ?? "",
    status: doc.status ?? "draft", access: doc.access ?? "free",
    scheduledAt: doc.scheduledAt ?? null,
    scheduledBy: doc.scheduledBy ?? null,
    publishedAt: doc.status === "published" ? now : null,
    body: JSON.stringify(doc.body ?? []),
    image: doc.image ? JSON.stringify(doc.image) : null,
    seoHeadline: doc.seoHeadline ?? null, socialHeadline: doc.socialHeadline ?? null,
    socialDescription: doc.socialDescription ?? null,
    readingTime: doc.readingTime ?? null, sortOrder: doc.sortOrder ?? null,
    now, lastEditedBy: doc.lastEditedBy ?? null,
  });
  ftsUpsert(db(), { id: doc._id, slug: doc.slug, section: doc.section, byline: doc.byline, headline: doc.headline, subheadline: doc.subheadline, body: doc.body });
}

export function sqliteDeletePost(id: string): void {
  db().prepare(`DELETE FROM posts WHERE id = ?`).run(id);
  ftsRemove(db(), id);
}

// Patch a few whitelisted post columns (editorial workflow fields) without a
// full save — used by the Calendar board's stage/assignee changes.
export function sqliteSetPostFields(id: string, fields: { stage?: string; assignee?: string | null; date?: string }): void {
  const sets: string[] = [], args: Record<string, unknown> = { id };
  if (fields.stage !== undefined) { sets.push("stage = @stage"); args.stage = fields.stage; }
  if (fields.assignee !== undefined) { sets.push("assignee = @assignee"); args.assignee = fields.assignee; }
  if (fields.date !== undefined) { sets.push("date = @date"); args.date = fields.date; }
  if (!sets.length) return;
  db().prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = @id`).run(args);
}

// Reschedule a calendar item to a new day. For scheduled items we move the
// auto-send/publish timestamp (preserving its time-of-day) so the card tracks
// what will actually happen; unscheduled stories just move their pub date.
export function sqliteRescheduleItem(kind: "story" | "newsletter", id: string, date: string): void {
  const now = new Date().toISOString();
  if (kind === "story") {
    const row = db().prepare(`SELECT status, scheduled_at FROM posts WHERE id = ?`).get(id) as { status?: string; scheduled_at?: string } | undefined;
    if (!row) return;
    if (row.status === "scheduled" && row.scheduled_at) {
      // Keep the same time-of-day; swap only the date portion of the ISO stamp.
      const time = row.scheduled_at.length > 10 ? row.scheduled_at.slice(10) : "T09:00:00.000Z";
      db().prepare(`UPDATE posts SET date = ?, scheduled_at = ?, updated_at = ? WHERE id = ?`).run(date, date + time, now, id);
    } else {
      db().prepare(`UPDATE posts SET date = ?, updated_at = ? WHERE id = ?`).run(date, now, id);
    }
    return;
  }
  // Newsletter: shift its scheduled send date (only meaningful while scheduled).
  const doc = sqliteGetDoc<{ scheduledAt?: string }>(id);
  if (!doc) return;
  const time = doc.scheduledAt && doc.scheduledAt.length > 10 ? doc.scheduledAt.slice(10) : "T09:00:00.000Z";
  patchDoc(id, { scheduledAt: date + time });
}

// Full-text search over posts. Uses the FTS5 index; falls back to a LIKE scan
// if FTS is unavailable. `publicOnly` restricts to reader-visible posts.
export function sqliteSearchPosts(query: string, opts: { limit?: number; publicOnly?: boolean; section?: string } = {}): SanityPost[] {
  const q = query.trim();
  if (!q) return [];
  const limit = opts.limit ?? 50;
  const d = db();
  const pubWhere = opts.publicOnly ? `AND (${PUBLIC_WHERE})` : `AND p.status != 'trashed'`;
  const sec = opts.section ? `AND p.section = @section` : "";
  const args: Record<string, unknown> = { limit, ...(opts.section ? { section: opts.section } : {}) };
  if (ftsHasTable(d)) {
    // Prefix-match each term so partial words hit ("shrimp" → "shrimper").
    // Strip punctuation from each term first, so a stray dash/quote the user
    // typed (e.g. "young writers —") can't become an empty phrase that
    // scrambles ranking or errors the whole query.
    const terms = q.toLowerCase().split(/\s+/).map(t => t.replace(/[^\p{L}\p{N}]+/gu, "")).filter(Boolean);
    if (!terms.length) return [];
    const match = terms.map(t => `"${t}"*`).join(" ");
    try {
      const rows = d.prepare(`
        SELECT p.* FROM posts_fts f JOIN posts p ON p.id = f.id
        WHERE posts_fts MATCH @match ${pubWhere} ${sec}
        ORDER BY bm25(posts_fts, 0, 0, 4, 3, 10, 6, 1) LIMIT @limit
      `).all({ ...args, match }) as PostRow[];
      return rows.map(rowToPost);
    } catch { /* malformed query → fall through to LIKE */ }
  }
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const rows = d.prepare(`
    SELECT p.* FROM posts p
    WHERE (p.headline LIKE @like OR p.subheadline LIKE @like OR p.byline LIKE @like OR p.body LIKE @like) ${pubWhere} ${sec}
    ORDER BY p.date DESC LIMIT @limit
  `).all({ ...args, like }) as PostRow[];
  return rows.map(rowToPost);
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
  const result = tx(records);
  // The archive is fully swapped — resync the whole search index to match.
  ftsReindexAll(d);
  return result;
}

export function sqliteSetStatus(id: string, status: string): void {
  // Leaving the scheduled state clears the schedule stamp — a stale
  // scheduled_at on a draft would read as still-scheduled in the editor.
  if (status === "scheduled") {
    db().prepare(`UPDATE posts SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
  } else {
    db().prepare(`UPDATE posts SET status = ?, scheduled_at = NULL, scheduled_by = NULL, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
  }
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

export function sqliteSaveMedia(filename: string, buf: Buffer, kind: "library" | "user" = "library"): { assetId: string; url: string } {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
  // User profile photos get a reserved prefix so the Media Library listing
  // can exclude them — headshots aren't editorial assets.
  const name = `${kind === "user" ? "userpic-" : ""}${Date.now()}-${safe}`;
  fs.writeFileSync(path.join(sqliteMediaDir(), name), buf);
  const url = `/media/${name}`;
  return { assetId: url, url };
}

export function sqliteListMedia(): { _id: string; _createdAt: string; url: string; originalFilename: string; size: number }[] {
  const dir = sqliteMediaDir();
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith(".") && !f.startsWith("userpic-"))
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
// All analytics readers accept an optional author filter. It matches the
// post's CURRENT byline (joined by slug) with a fallback to the byline
// snapshotted on the event for slugs that no longer exist — the same rule the
// byline breakdown groups by, so the filter and the Authors chart agree.
const AUTHOR_JOIN = `LEFT JOIN posts p ON p.slug = e.slug`;
const AUTHOR_COND = `AND COALESCE(NULLIF(p.byline, ''), e.byline) = @author`;

export function sqliteAnalyticsOverview(since: number, until: number, author?: string): {
  views: number; visitors: number; engagedMs: number; avgEngagedMs: number;
} {
  const j = author ? AUTHOR_JOIN : "", c = author ? AUTHOR_COND : "";
  const args = { since, until, ...(author ? { author } : {}) };
  const v = db().prepare(`SELECT COUNT(*) c, COUNT(DISTINCT e.session) u FROM analytics_events e ${j} WHERE e.kind='view' AND e.ts>=@since AND e.ts<@until ${c}`).get(args) as Row;
  // Average engaged time is per *engaged session*, not per pageview — dividing
  // by all views (bounces, bots, prefetches that never engage) drags the
  // average to ~0 and the KPI perpetually reads "0s".
  const e = db().prepare(`SELECT COALESCE(SUM(e.engaged_ms),0) s, COUNT(DISTINCT e.session) n FROM analytics_events e ${j} WHERE e.kind='engage' AND e.ts>=@since AND e.ts<@until ${c}`).get(args) as Row;
  const views = num(v.c), engagedMs = num(e.s), engagedSessions = num(e.n);
  return { views, visitors: num(v.u), engagedMs, avgEngagedMs: engagedSessions ? Math.round(engagedMs / engagedSessions) : 0 };
}

// View counts bucketed into `buckets` equal time slices across [since, until) —
// for the time-series chart.
export function sqliteAnalyticsSeries(since: number, until: number, buckets: number, author?: string): number[] {
  const span = Math.max(1, until - since);
  const width = span / buckets;
  const j = author ? AUTHOR_JOIN : "", c = author ? AUTHOR_COND : "";
  const rows = db().prepare(`SELECT e.ts ts FROM analytics_events e ${j} WHERE e.kind='view' AND e.ts>=@since AND e.ts<@until ${c}`).all({ since, until, ...(author ? { author } : {}) }) as Row[];
  const out = new Array(buckets).fill(0);
  for (const r of rows) {
    const i = Math.min(buckets - 1, Math.floor((num(r.ts) - since) / width));
    out[i]++;
  }
  return out;
}

// Top stories by views (with visitors + avg engaged time) in the window.
export function sqliteAnalyticsTopContent(since: number, until: number, limit = 20, author?: string): {
  slug: string; section: string; byline: string; views: number; visitors: number; avgEngagedMs: number;
}[] {
  const j = author ? AUTHOR_JOIN : "", c = author ? AUTHOR_COND : "";
  const args = { since, until, limit, ...(author ? { author } : {}) };
  const views = db().prepare(`
    SELECT e.slug slug, e.section section, e.byline byline, COUNT(*) v, COUNT(DISTINCT e.session) u
    FROM analytics_events e ${j} WHERE e.kind='view' AND e.ts>=@since AND e.ts<@until AND e.slug != '' ${c}
    GROUP BY e.slug ORDER BY v DESC LIMIT @limit`).all(args) as Row[];
  const eng = db().prepare(`
    SELECT slug, COALESCE(SUM(engaged_ms),0) e, COUNT(DISTINCT session) n FROM analytics_events
    WHERE kind='engage' AND ts>=? AND ts<? GROUP BY slug`).all(since, until) as Row[];
  // Per engaged session (see sqliteAnalyticsOverview), not per view.
  const engBySlug = new Map(eng.map(r => [String(r.slug), { ms: num(r.e), n: num(r.n) }]));
  return views.map(r => {
    const v = num(r.v);
    const en = engBySlug.get(String(r.slug));
    return {
      slug: String(r.slug), section: String(r.section ?? ""), byline: String(r.byline ?? ""),
      views: v, visitors: num(r.u),
      avgEngagedMs: en && en.n ? Math.round(en.ms / en.n) : 0,
    };
  });
}

// Generic "views grouped by <column>" for referrers/sources/sections/authors/device.
export function sqliteAnalyticsBreakdown(column: "source" | "section" | "byline" | "device" | "ref_host", since: number, until: number, limit = 12, author?: string): { key: string; views: number }[] {
  // byline/section are snapshotted into each event at view time, so events
  // recorded before an author rename (e.g. the archive's "Ben" -> "Ben
  // Montgomery" cleanup) group separately from newer ones and one person
  // shows up twice. Group those by the post's CURRENT value instead, keyed by
  // slug, falling back to the event snapshot for slugs that no longer exist.
  const c = author ? AUTHOR_COND : "";
  const args = { since, until, limit, ...(author ? { author } : {}) };
  const rows = (column === "byline" || column === "section"
    ? db().prepare(
        `SELECT COALESCE(NULLIF(p.BREAKCOL, ''), e.BREAKCOL) k, COUNT(*) v
         FROM analytics_events e LEFT JOIN posts p ON p.slug = e.slug
         WHERE e.kind='view' AND e.ts>=@since AND e.ts<@until ${c} GROUP BY k ORDER BY v DESC LIMIT @limit`.replaceAll("BREAKCOL", column)
      ).all(args)
    : db().prepare(
        `SELECT e.BREAKCOL k, COUNT(*) v FROM analytics_events e ${author ? AUTHOR_JOIN : ""}
         WHERE e.kind='view' AND e.ts>=@since AND e.ts<@until ${c} GROUP BY e.BREAKCOL ORDER BY v DESC LIMIT @limit`.replaceAll("BREAKCOL", column)
      ).all(args)) as Row[];
  return rows.map(r => ({ key: String(r.k ?? "") || "\u2014", views: num(r.v) }));
}

// Real-time: distinct sessions active in the last `windowMs`, plus what each is
// reading (most recent view per active session).
export function sqliteAnalyticsRealtime(windowMs = 5 * 60_000, author?: string): { active: number; reading: { slug: string; views: number }[] } {
  const since = Date.now() - windowMs;
  const j = author ? AUTHOR_JOIN : "", c = author ? AUTHOR_COND : "";
  const args = { since, ...(author ? { author } : {}) };
  const a = db().prepare(`SELECT COUNT(DISTINCT e.session) u FROM analytics_events e ${j} WHERE e.ts>=@since ${c}`).get(args) as Row;
  const reading = db().prepare(`
    SELECT e.slug slug, COUNT(DISTINCT e.session) views FROM analytics_events e ${j}
    WHERE e.kind='view' AND e.ts>=@since AND e.slug != '' ${c} GROUP BY e.slug ORDER BY views DESC LIMIT 10`).all(args) as Row[];
  return { active: num(a.u), reading: reading.map(r => ({ slug: String(r.slug), views: num(r.views) })) };
}

// Trending: stories whose recent view velocity most exceeds their prior baseline
// — surfaces what's heating up, not just what's all-time popular.
export function sqliteAnalyticsTrending(limit = 10, author?: string): { slug: string; recent: number; score: number }[] {
  const now = Date.now();
  const recentSince = now - 3 * 3600_000;      // last 3h
  const baseSince = now - 27 * 3600_000;       // prior 24h before that
  const j = author ? AUTHOR_JOIN : "", c = author ? AUTHOR_COND : "";
  const recent = db().prepare(`SELECT e.slug slug, COUNT(*) v FROM analytics_events e ${j} WHERE e.kind='view' AND e.ts>=@since AND e.slug!='' ${c} GROUP BY e.slug`).all({ since: recentSince, ...(author ? { author } : {}) }) as Row[];
  const base = db().prepare(`SELECT e.slug slug, COUNT(*) v FROM analytics_events e ${j} WHERE e.kind='view' AND e.ts>=@since AND e.ts<@until AND e.slug!='' ${c} GROUP BY e.slug`).all({ since: baseSince, until: recentSince, ...(author ? { author } : {}) }) as Row[];
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

