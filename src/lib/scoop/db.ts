import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { dataDir } from "./config";

// Scoop keeps its own database file so reporting-tool data never mingles with
// the magazine's. Same engine and dir as imago.db, so backups cover both.
let _db: Database.Database | null = null;

export function scoopDb(): Database.Database {
  if (_db) return _db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  _db = new Database(path.join(dir, "scoop.db"));
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,               -- 'civicdata' | 'manual'
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
      raw_json TEXT NOT NULL,             -- every original column, unrenamed
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
      cluster_key TEXT DEFAULT '',        -- parcel, else normalized address
      score INTEGER DEFAULT 0,
      score_reasons TEXT DEFAULT '[]',    -- JSON [ [points, label], ... ]
      first_seen_at TEXT NOT NULL,        -- when WE first saw it (not filed date)
      last_seen_at TEXT NOT NULL,
      changed_at TEXT,                    -- last time a field actually changed
      first_import_id INTEGER,
      last_import_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_permits_cluster ON permits (cluster_key);
    CREATE INDEX IF NOT EXISTS idx_permits_first_seen ON permits (first_seen_at);
    CREATE INDEX IF NOT EXISTS idx_permits_score ON permits (score);
    CREATE TABLE IF NOT EXISTS permit_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      permit_id TEXT NOT NULL,
      import_id INTEGER,
      changed_at TEXT NOT NULL,
      diff_json TEXT NOT NULL             -- { field: { from, to } }
    );
    CREATE INDEX IF NOT EXISTS idx_versions_permit ON permit_versions (permit_id);
  `);
  return _db;
}

export function rawReportDir(dateISO: string): string {
  const dir = path.join(dataDir(), "raw", "tampa_daily_permits", dateISO.slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
