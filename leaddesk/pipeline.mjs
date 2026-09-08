import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config, DATA_DIR } from "./config.mjs";

// The Lead Desk pipeline: normalize -> dedupe by city permit id -> version
// changes -> score -> cluster -> queue. Storage is its own SQLite file plus a
// verbatim raw archive; nothing here touches the magazine's database.

let _db = null;
export function db() {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(path.join(DATA_DIR, "leaddesk.db"));
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,               -- 'arcgis' | 'civicdata' | 'manual'
      filename TEXT NOT NULL,
      file_hash TEXT NOT NULL UNIQUE,
      imported_at TEXT NOT NULL,
      report_start_date TEXT,
      report_end_date TEXT,
      row_count INTEGER DEFAULT 0,
      inserted_count INTEGER DEFAULT 0,
      changed_count INTEGER DEFAULT 0,
      unchanged_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS permits (
      permit_id TEXT PRIMARY KEY,         -- the city's identifier, verbatim
      raw_json TEXT NOT NULL,             -- every original field, unrenamed
      record_type TEXT DEFAULT '',
      description TEXT DEFAULT '',
      project_name TEXT DEFAULT '',
      address TEXT DEFAULT '',
      parcel TEXT DEFAULT '',
      status TEXT DEFAULT '',
      applied_date TEXT DEFAULT '',       -- the city's filing date
      issued_date TEXT DEFAULT '',
      valuation REAL,
      contractor TEXT DEFAULT '',
      applicant TEXT DEFAULT '',
      owner TEXT DEFAULT '',
      link TEXT DEFAULT '',
      cluster_key TEXT DEFAULT '',
      score INTEGER DEFAULT 0,
      score_reasons TEXT DEFAULT '[]',
      first_seen_at TEXT NOT NULL,        -- when WE first saw it (not filed date)
      last_seen_at TEXT NOT NULL,
      changed_at TEXT,
      first_import_id INTEGER,
      last_import_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_permits_cluster ON permits (cluster_key);
    CREATE INDEX IF NOT EXISTS idx_permits_first_seen ON permits (first_seen_at);
    CREATE TABLE IF NOT EXISTS permit_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      permit_id TEXT NOT NULL,
      import_id INTEGER,
      changed_at TEXT NOT NULL,
      diff_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_versions_permit ON permit_versions (permit_id);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  return _db;
}

// ---------- parsing helpers ----------

// RFC-4180-ish CSV: quoted fields, embedded commas/quotes/newlines, BOM.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
  return rows;
}

export function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
}

const keyOf = h => String(h).toLowerCase().replace(/[^a-z0-9]/g, "");

function pick(rec, keyed, candidates) {
  for (const c of candidates) {
    const k = keyed.get(keyOf(c));
    if (k !== undefined) {
      const v = rec[k];
      if (v !== undefined && v !== null && v !== "") return normValue(v);
    }
  }
  return "";
}

// ArcGIS sends dates as epoch milliseconds — turn plausible ones into ISO days.
function normValue(v) {
  if (typeof v === "number" && v > 1e11 && v < 4e12) return new Date(v).toISOString().slice(0, 10);
  return String(v).trim();
}

function parseValuation(v) {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeAddress(addr) {
  return String(addr).toUpperCase()
    .replace(/\b(STE|SUITE|UNIT|APT|#)\s*\S*/g, "")
    .replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

function scoreRecord(recordType, description, projectName, valuation) {
  const cfg = config();
  const hay = `${recordType} ${description} ${projectName}`.toLowerCase();
  const reasons = [];
  for (const list of [cfg.typeSignals, cfg.keywordSignals, cfg.brandSignals]) {
    for (const [pattern, points, label] of list) {
      try { if (new RegExp(pattern, "i").test(hay)) reasons.push([points, label]); } catch { /* bad config pattern */ }
    }
  }
  if (valuation != null) {
    const tier = cfg.valuationTiers.find(t => valuation >= t.min);
    if (tier) reasons.push([tier.points, tier.label]);
  }
  return { score: reasons.reduce((s, [p]) => s + p, 0), reasons };
}

const TRACKED = ["record_type", "description", "project_name", "address", "parcel", "status", "applied_date", "issued_date", "valuation", "contractor", "applicant", "owner"];

// ---------- import ----------

// records: array of plain objects (original field names). buf: the exact bytes
// of the source (CSV file or the raw JSON we fetched) — preserved verbatim.
export function importRecords(records, buf, filename, source) {
  const d = db();
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  if (d.prepare(`SELECT id FROM imports WHERE file_hash = ?`).get(hash)) {
    return { alreadyImported: true, filename, rowCount: 0, inserted: 0, changed: 0, unchanged: 0, errors: 0 };
  }
  const now = new Date().toISOString();
  // Preserve the original before any processing; hash prefix means two
  // same-named files on one day can never overwrite each other.
  const dir = path.join(DATA_DIR, "raw", "tampa_daily_permits", now.slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const safeName = String(filename).replace(/[^A-Za-z0-9._-]/g, "_") || "report";
  fs.writeFileSync(path.join(dir, `${hash.slice(0, 12)}-${safeName}`), buf);

  const fm = config().fieldMap;
  let inserted = 0, changed = 0, unchanged = 0, errors = 0, minDate = "", maxDate = "";

  const getStmt = d.prepare(`SELECT * FROM permits WHERE permit_id = ?`);
  const insStmt = d.prepare(`INSERT INTO permits (permit_id, raw_json, record_type, description, project_name, address, parcel, status, applied_date, issued_date, valuation, contractor, applicant, owner, link, cluster_key, score, score_reasons, first_seen_at, last_seen_at, first_import_id, last_import_id)
    VALUES (@permit_id, @raw_json, @record_type, @description, @project_name, @address, @parcel, @status, @applied_date, @issued_date, @valuation, @contractor, @applicant, @owner, @link, @cluster_key, @score, @score_reasons, @now, @now, @import_id, @import_id)`);
  const updStmt = d.prepare(`UPDATE permits SET raw_json=@raw_json, record_type=@record_type, description=@description, project_name=@project_name, address=@address, parcel=@parcel, status=@status, applied_date=@applied_date, issued_date=@issued_date, valuation=@valuation, contractor=@contractor, applicant=@applicant, owner=@owner, link=@link, cluster_key=@cluster_key, score=@score, score_reasons=@score_reasons, last_seen_at=@now, changed_at=@now, last_import_id=@import_id WHERE permit_id=@permit_id`);
  const touchStmt = d.prepare(`UPDATE permits SET last_seen_at=@now, last_import_id=@import_id WHERE permit_id=@permit_id`);
  const verStmt = d.prepare(`INSERT INTO permit_versions (permit_id, import_id, changed_at, diff_json) VALUES (?, ?, ?, ?)`);

  const imp = d.prepare(`INSERT INTO imports (source, filename, file_hash, imported_at) VALUES (?, ?, ?, ?)`).run(source, filename, hash, now);
  const importId = Number(imp.lastInsertRowid);

  d.transaction(() => {
    for (const rec of records) {
      try {
        const keyed = new Map();
        for (const k of Object.keys(rec)) if (!keyed.has(keyOf(k))) keyed.set(keyOf(k), k);
        const permitId = pick(rec, keyed, fm.permitId);
        if (!permitId) { errors++; continue; }

        const row = {
          permit_id: permitId,
          raw_json: JSON.stringify(rec),
          record_type: pick(rec, keyed, fm.recordType),
          description: pick(rec, keyed, fm.description),
          project_name: pick(rec, keyed, fm.projectName),
          address: pick(rec, keyed, fm.address),
          parcel: pick(rec, keyed, fm.parcel),
          status: pick(rec, keyed, fm.status),
          applied_date: pick(rec, keyed, fm.appliedDate).slice(0, 10),
          issued_date: pick(rec, keyed, fm.issuedDate).slice(0, 10),
          valuation: parseValuation(pick(rec, keyed, fm.valuation)),
          contractor: pick(rec, keyed, fm.contractor),
          applicant: pick(rec, keyed, fm.applicant),
          owner: pick(rec, keyed, fm.owner),
          link: pick(rec, keyed, fm.link),
        };
        const { score, reasons } = scoreRecord(row.record_type, row.description, row.project_name, row.valuation);
        const cluster_key = row.parcel ? `parcel:${row.parcel}` : row.address ? `addr:${normalizeAddress(row.address)}` : `id:${permitId}`;

        if (row.applied_date) {
          if (!minDate || row.applied_date < minDate) minDate = row.applied_date;
          if (!maxDate || row.applied_date > maxDate) maxDate = row.applied_date;
        }

        const existing = getStmt.get(permitId);
        if (!existing) {
          insStmt.run({ ...row, cluster_key, score, score_reasons: JSON.stringify(reasons), now, import_id: importId });
          inserted++;
        } else {
          const diff = {};
          for (const f of TRACKED) {
            const newV = row[f];
            // A blank in a later export is the export omitting the field, not
            // the city erasing it — never let it clobber a known value.
            if (newV === "" || newV === null) continue;
            if (String(existing[f] ?? "") !== String(newV)) diff[f] = { from: existing[f] ?? null, to: newV };
          }
          if (Object.keys(diff).length) {
            const merged = { ...row };
            for (const f of TRACKED) if (merged[f] === "" || merged[f] === null) merged[f] = existing[f] ?? merged[f];
            const s2 = scoreRecord(merged.record_type, merged.description, merged.project_name, merged.valuation);
            updStmt.run({ ...merged, permit_id: permitId, raw_json: row.raw_json, cluster_key, score: s2.score, score_reasons: JSON.stringify(s2.reasons), now, import_id: importId });
            verStmt.run(permitId, importId, now, JSON.stringify(diff));
            changed++;
          } else {
            touchStmt.run({ now, import_id: importId, permit_id: permitId });
            unchanged++;
          }
        }
      } catch { errors++; }
    }
    d.prepare(`UPDATE imports SET row_count=?, inserted_count=?, changed_count=?, unchanged_count=?, error_count=?, report_start_date=?, report_end_date=? WHERE id=?`)
      .run(records.length, inserted, changed, unchanged, errors, minDate || null, maxDate || null, importId);
  })();

  return { alreadyImported: false, importId, filename, source, rowCount: records.length, inserted, changed, unchanged, errors, reportStart: minDate, reportEnd: maxDate };
}

// ---------- queue ----------

const RESTAURANT_RE = /restaurant|cafe|café|coffee|\bbar\b|brewery|taproom|pizza|grill|kitchen|hood|grease|ansul|drive.?thr/i;
const DEVELOPMENT_RE = /new construction|addition|demolition|site|mixed.?use|multifamily|multi-family|apartments|hotel|tower/i;

export function getLeads(f = {}) {
  const d = db();
  const since = new Date(Date.now() - (f.sinceDays ?? 7) * 86400000).toISOString();
  const rows = d.prepare(`
    SELECT * FROM permits WHERE cluster_key IN (
      SELECT DISTINCT cluster_key FROM permits
      WHERE first_seen_at >= @since OR (changed_at IS NOT NULL AND changed_at >= @since)
    )`).all({ since });

  const clusters = new Map();
  for (const r of rows) {
    const k = r.cluster_key;
    if (!clusters.has(k)) clusters.set(k, []);
    clusters.get(k).push(r);
  }

  const leads = [];
  for (const [clusterKey, permits] of clusters) {
    const sorted = [...permits].sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const isNew = permits.some(p => p.first_seen_at >= since);
    const isChanged = permits.some(p => p.changed_at && p.changed_at >= since);
    const reasons = [], seen = new Set();
    for (const p of sorted) {
      let rs = [];
      try { rs = JSON.parse(p.score_reasons || "[]"); } catch {}
      for (const r of rs) if (!seen.has(r[1])) { seen.add(r[1]); reasons.push(r); }
    }
    const hay = permits.map(p => `${p.record_type} ${p.description} ${p.project_name}`).join(" ");
    const lead = {
      clusterKey,
      address: top.address ?? "",
      parcel: top.parcel ?? "",
      projectName: permits.map(p => p.project_name).find(Boolean) ?? "",
      firstSeen: permits.map(p => p.first_seen_at).sort()[0],
      lastActivity: permits.map(p => p.changed_at ?? p.first_seen_at).sort().slice(-1)[0],
      permitCount: permits.length,
      topScore: top.score ?? 0,
      isNew, isChanged,
      reasons: reasons.sort((a, b) => b[0] - a[0]).slice(0, 8),
      permits: sorted.map(p => ({
        permitId: p.permit_id, recordType: p.record_type ?? "", description: p.description ?? "",
        status: p.status ?? "", appliedDate: p.applied_date ?? "", valuation: p.valuation ?? null,
        score: p.score ?? 0, firstSeenAt: p.first_seen_at, changedAt: p.changed_at ?? null, link: p.link ?? "",
      })),
    };
    if (f.onlyNew && !lead.isNew) continue;
    if (f.onlyChanged && !lead.isChanged) continue;
    if (f.minScore != null && lead.topScore < f.minScore) continue;
    if (f.restaurants && !RESTAURANT_RE.test(hay)) continue;
    if (f.development && !DEVELOPMENT_RE.test(hay)) continue;
    leads.push(lead);
  }
  return leads.sort((a, b) => b.topScore - a.topScore || String(b.lastActivity).localeCompare(String(a.lastActivity)));
}

export function lastImports(limit = 10) {
  return db().prepare(`SELECT * FROM imports ORDER BY imported_at DESC LIMIT ?`).all(limit);
}

export function queueBands(leads) {
  const cfg = config();
  return {
    high: leads.filter(l => l.topScore >= cfg.highPriorityMin).length,
    watch: leads.filter(l => l.topScore >= cfg.watchMin && l.topScore < cfg.highPriorityMin).length,
  };
}

// Column inventory from real stored rows — feeds docs/TAMPA_DAILY_PERMIT_REPORT.md.
export function schemaReport(sampleSize = 500) {
  const rows = db().prepare(`SELECT raw_json FROM permits ORDER BY last_seen_at DESC LIMIT ?`).all(sampleSize);
  const cols = new Map();
  for (const r of rows) {
    let raw;
    try { raw = JSON.parse(r.raw_json); } catch { continue; }
    for (const [k, v] of Object.entries(raw)) {
      const c = cols.get(k) ?? { filled: 0, samples: new Set() };
      if (v !== "" && v != null) { c.filled++; if (c.samples.size < 5) c.samples.add(String(v).slice(0, 80)); }
      cols.set(k, c);
    }
  }
  return [...cols.entries()].map(([column, c]) => ({ column, filled: c.filled, total: rows.length, samples: [...c.samples] }));
}

export function getMeta(key) {
  const r = db().prepare(`SELECT value FROM meta WHERE key = ?`).get(key);
  return r ? r.value : null;
}
export function setMeta(key, value) {
  db().prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}
