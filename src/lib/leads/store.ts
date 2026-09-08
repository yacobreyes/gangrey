import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// Lead Desk v2 — permit-lead pipeline for the Tampa and Hillsborough feeds.
// Architecture: the reporter's BROWSER collects from the two ArcGIS feeds
// (their US residential IP is served; the VPS is WAF-blocked) and posts raw
// records here; this module normalizes, dedupes, versions, scores, clusters
// and serves the ranked queue. Schemas are the VERIFIED ones in
// docs/TAMPA_PERMIT_SOURCES.md — no guessed field names.

export type SourceId = "tampa" | "hcfl";

const DATA_DIR = () => process.env.DATA_DIR || path.join(process.cwd(), "data");

let _db: Database.Database | null = null;
export function leadsDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR(), { recursive: true });
  _db = new Database(path.join(DATA_DIR(), "leads.db"));
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ingests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      batch_hash TEXT NOT NULL UNIQUE,
      ingested_at TEXT NOT NULL,
      row_count INTEGER DEFAULT 0,
      inserted_count INTEGER DEFAULT 0,
      changed_count INTEGER DEFAULT 0,
      unchanged_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS permits (
      uid TEXT PRIMARY KEY,              -- source-prefixed stable key
      source TEXT NOT NULL,
      permit_no TEXT NOT NULL,           -- the human permit number
      raw_json TEXT NOT NULL,            -- original fields, unrenamed
      record_type TEXT DEFAULT '',
      type2 TEXT DEFAULT '',             -- hcfl 4-way rollup ('' for tampa)
      description TEXT DEFAULT '',
      address TEXT DEFAULT '',
      jurisdiction TEXT DEFAULT '',      -- hcfl CITY_1 / 'Tampa' for city feed
      parcel TEXT DEFAULT '',
      status TEXT DEFAULT '',
      occupancy TEXT DEFAULT '',
      stop_work INTEGER DEFAULT 0,
      valuation REAL,
      sq_ft REAL,
      units REAL,
      neighborhood TEXT DEFAULT '',
      council TEXT DEFAULT '',
      cra TEXT DEFAULT '',
      issued_date TEXT DEFAULT '',
      created_date TEXT DEFAULT '',
      source_updated TEXT DEFAULT '',    -- the feed's own change timestamp
      link TEXT DEFAULT '',
      cluster_key TEXT DEFAULT '',
      score INTEGER DEFAULT 0,
      score_reasons TEXT DEFAULT '[]',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      changed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_leads_cluster ON permits (cluster_key);
    CREATE INDEX IF NOT EXISTS idx_leads_seen ON permits (first_seen_at);
    CREATE TABLE IF NOT EXISTS permit_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      diff_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS contexts (
      cluster_key TEXT PRIMARY KEY,      -- joins onto the lead's cluster
      owner TEXT DEFAULT '',
      dba TEXT DEFAULT '',               -- business name on the parcel
      folio TEXT DEFAULT '',
      just_value REAL,                   -- appraiser just value
      sale_amt REAL,
      sale_date TEXT DEFAULT '',
      year_built INTEGER,
      use_code TEXT DEFAULT '',
      site_addr TEXT DEFAULT '',
      fetched_at TEXT NOT NULL
    );
  `);
  return _db;
}

// ---------- config (scoring lists editable without a deploy) ----------

type Signal = [string, number, string];
type LeadsConfig = {
  keywordSignals: Signal[];
  brandSignals: Signal[];
  valuationTiers: { min: number; points: number; label: string }[];
  sqftTiers: { min: number; points: number; label: string }[];
  highPriorityMin: number;
  watchMin: number;
  initialWindowDays: number; // first browser collection reaches back this far
};

const DEFAULT_CONFIG: LeadsConfig = {
  keywordSignals: [
    ["restaurant", 5, "restaurant"], ["\\bcafe\\b|\\bcafé\\b", 4, "cafe"], ["coffee", 4, "coffee"],
    ["\\bbar\\b|cocktail|lounge", 3, "bar"], ["brewery|brewing|taproom|tap room", 5, "brewery/taproom"],
    ["pizza|pizzeria", 4, "pizza"], ["\\bgrill\\b", 3, "grill"], ["kitchen", 3, "kitchen"],
    ["tenant (buildout|build-out|build out|improvement)", 4, "tenant buildout"],
    ["\\bhood\\b", 4, "kitchen hood"], ["grease", 4, "grease system"], ["ansul", 5, "Ansul system"],
    ["drive.?thr(u|ough)", 4, "drive-through"],
    ["hotel|apartments|mixed.?use|multifamily|multi-family", 3, "large development"],
    ["stadium|arena|tower", 3, "major project"],
  ],
  brandSignals: [
    ["chick.?fil.?a", 6, "Chick-fil-A"], ["starbucks", 6, "Starbucks"], ["chipotle", 6, "Chipotle"],
    ["mcdonald", 5, "McDonald's"], ["wawa", 5, "Wawa"], ["publix", 6, "Publix"], ["whataburger", 6, "Whataburger"],
    ["trader joe", 7, "Trader Joe's"], ["whole foods", 7, "Whole Foods"], ["costco", 7, "Costco"],
    ["raising cane", 6, "Raising Cane's"], ["dutch bros", 6, "Dutch Bros"], ["shake shack", 6, "Shake Shack"],
    ["texas roadhouse", 5, "Texas Roadhouse"], ["aldi", 5, "Aldi"], ["sprouts", 5, "Sprouts"],
    ["target", 5, "Target"], ["amazon", 5, "Amazon"],
  ],
  valuationTiers: [
    { min: 10_000_000, points: 5, label: "valuation > $10M" },
    { min: 1_000_000, points: 3, label: "valuation > $1M" },
    { min: 250_000, points: 2, label: "valuation > $250K" },
  ],
  sqftTiers: [
    { min: 100_000, points: 4, label: "> 100K sq ft" },
    { min: 20_000, points: 2, label: "> 20K sq ft" },
  ],
  highPriorityMin: 8,
  watchMin: 4,
  initialWindowDays: 30,
};

let cachedConfig: LeadsConfig | null = null;
export function leadsConfig(): LeadsConfig {
  if (cachedConfig) return cachedConfig;
  let overrides: Partial<LeadsConfig> = {};
  try {
    const p = path.join(DATA_DIR(), "leads.config.json");
    if (fs.existsSync(p)) overrides = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* bad JSON: defaults */ }
  cachedConfig = { ...DEFAULT_CONFIG, ...overrides };
  return cachedConfig;
}

// ---------- normalization (verified schemas only) ----------

type Raw = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const epochToDay = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 1e11 ? new Date(n).toISOString().slice(0, 10) : ""; };

export function normalizeAddress(addr: string): string {
  return addr.toUpperCase()
    .replace(/\b(STE|SUITE|UNIT|APT|#)\s*\S*/g, "")
    .replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

type Norm = {
  uid: string; permit_no: string; record_type: string; type2: string; description: string;
  address: string; jurisdiction: string; parcel: string; status: string; occupancy: string;
  stop_work: number; valuation: number | null; sq_ft: number | null; units: number | null;
  neighborhood: string; council: string; cra: string;
  issued_date: string; created_date: string; source_updated: string; link: string;
};

// City of Tampa Planning/PermitsAll layer 0. RECORD_ID is unique.
function normTampa(r: Raw): Norm | null {
  const id = s(r.RECORD_ID);
  if (!id) return null;
  return {
    uid: `tampa:${id}`, permit_no: id,
    record_type: s(r.RECORDTYPE), type2: "",
    description: [s(r.PROJECTNAME1), s(r.PROJECTNAME2), s(r.PROJECTDESCRIPTION)].filter(Boolean).join(" — ").replace(/ — /g, " - "),
    address: [s(r.ADDRESS), s(r.UNIT)].filter(Boolean).join(" "), jurisdiction: "Tampa",
    parcel: "", status: s(r.PROJECTSTATUS),
    occupancy: [s(r.OCCUPANCYTYPE), s(r.OCCUPANCYCATEGORY)].filter(Boolean).join(" / "),
    stop_work: s(r.STOPWORKORDER).toLowerCase() === "yes" ? 1 : 0,
    valuation: null, sq_ft: num(r.NEWCONSTRUCTIONSF), units: num(r.NBROFUNITS),
    neighborhood: s(r.NEIGHBORHOOD), council: s(r.COUNCIL), cra: s(r.CRA),
    issued_date: "", created_date: epochToDay(r.CREATEDDATE), source_updated: epochToDay(r.LASTUPDATE),
    link: s(r.URL),
  };
}

// Hillsborough GIS_Dashboard_Issued_CO_Merged layer 0. PERMIT__ is NOT
// unique (verified: COM05190 appears twice) — key on permit+category+date.
function normHcfl(r: Raw): Norm | null {
  const id = s(r.PERMIT__);
  if (!id) return null;
  const issued = epochToDay(r.ISSUED_DATE);
  const combined = epochToDay(r.COMBINED_DATE);
  return {
    uid: `hcfl:${id}|${s(r.CATEGORY)}|${issued || combined}`, permit_no: id,
    record_type: s(r.TYPE), type2: s(r.TYPE2),
    description: s(r.DESCRIPTION),
    address: s(r.ADDRESS), jurisdiction: s(r.CITY_1),
    parcel: s(r.PARCEL), status: s(r.STATUS_1),
    occupancy: [s(r.OCCUPANCY_TYPE), s(r.OCCUPANCY_CATEGORY)].filter(Boolean).join(" / "),
    stop_work: 0,
    valuation: num(r.Value), sq_ft: num(r.SF_Total), units: num(r.Unit_Cnt),
    neighborhood: "", council: "", cra: "",
    issued_date: issued, created_date: "", source_updated: combined || issued,
    link: s(r.ACA_LINK),
  };
}

// ---------- scoring ----------

function scoreRecord(n: Norm, isCo = false): { score: number; reasons: [number, string][] } {
  const cfg = leadsConfig();
  const reasons: [number, string][] = [];
  const hay = `${n.record_type} ${n.type2} ${n.description} ${n.occupancy}`.toLowerCase();
  const commercial = /commercial|mercantile|assembly|business|institutional|mixed.?use/.test(hay);
  const residential = /residential|single.?family|\bsfr\b/.test(hay) && !commercial;

  if (n.stop_work) reasons.push([6, "stop work order"]);
  if (commercial) {
    // Work type: what kind of commercial activity this is.
    if (/new construction/.test(hay)) reasons.push([5, "commercial new construction"]);
    else if (/alteration|renovation|remodel|buildout|build.?out/.test(hay)) reasons.push([4, "commercial alteration"]);
    else if (/demolition|\bdemo\b/.test(hay)) reasons.push([4, "commercial demolition"]);
    else if (/addition/.test(hay)) reasons.push([4, "commercial addition"]);
    // Trade permits: individually small, but they stack in a cluster and a
    // fire+mechanical+plumbing trio is the classic restaurant buildout shape.
    if (/fire/.test(hay)) reasons.push([2, "fire trade permit"]);
    if (/mechanical|\bhvac\b/.test(hay)) reasons.push([2, "mechanical trade permit"]);
    if (/plumbing/.test(hay)) reasons.push([2, "plumbing trade permit"]);
    if (/\bsite\b/.test(hay)) reasons.push([2, "site trade permit"]);
    if (reasons.length === (n.stop_work ? 1 : 0)) reasons.push([1, "commercial"]);
    // A CO on a commercial record: the business is about to open.
    if (isCo) reasons.push([4, "certificate of occupancy"]);
  }
  for (const list of [cfg.keywordSignals, cfg.brandSignals]) {
    for (const [pattern, points, label] of list) {
      try { if (new RegExp(pattern, "i").test(hay)) reasons.push([points, label]); } catch { /* bad config pattern */ }
    }
  }
  // Scale tiers describe project size; they only mean news on commercial work
  // (a big single-family house is not a lead).
  if (!residential) {
    if (n.valuation != null) {
      const t = cfg.valuationTiers.find(t => n.valuation! >= t.min);
      if (t) reasons.push([t.points, t.label]);
    } else if (n.sq_ft != null) {
      const t = cfg.sqftTiers.find(t => n.sq_ft! >= t.min);
      if (t) reasons.push([t.points, t.label]);
    }
  }
  let score = reasons.reduce((sum, [p]) => sum + p, 0);
  // Plain residential noise never outranks commercial leads.
  if (residential && score > 3 && !reasons.some(([, l]) => l === "stop work order")) score = 3;
  return { score, reasons };
}

const TRACKED = ["record_type", "description", "address", "status", "occupancy", "stop_work", "valuation", "sq_ft", "units", "issued_date", "source_updated", "link"] as const;

export type IngestSummary = {
  alreadyIngested: boolean; rowCount: number; inserted: number; changed: number; unchanged: number; skipped: number;
};

export function ingestRecords(source: SourceId, records: Raw[]): IngestSummary {
  const db = leadsDb();
  const buf = Buffer.from(JSON.stringify(records));
  const hash = crypto.createHash("sha256").update(source + ":").update(buf).digest("hex");
  if (db.prepare(`SELECT id FROM ingests WHERE batch_hash = ?`).get(hash)) {
    return { alreadyIngested: true, rowCount: 0, inserted: 0, changed: 0, unchanged: 0, skipped: 0 };
  }
  const now = new Date().toISOString();
  // Preserve the raw batch before processing — never lose a source payload.
  const dir = path.join(DATA_DIR(), "raw", "leads", now.slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${hash.slice(0, 12)}-${source}.json`), buf);

  const norm = source === "tampa" ? normTampa : normHcfl;
  let inserted = 0, changed = 0, unchanged = 0, skipped = 0;

  const getStmt = db.prepare(`SELECT * FROM permits WHERE uid = ?`);
  const insStmt = db.prepare(`INSERT INTO permits (uid, source, permit_no, raw_json, record_type, type2, description, address, jurisdiction, parcel, status, occupancy, stop_work, valuation, sq_ft, units, neighborhood, council, cra, issued_date, created_date, source_updated, link, cluster_key, score, score_reasons, first_seen_at, last_seen_at)
    VALUES (@uid, @source, @permit_no, @raw_json, @record_type, @type2, @description, @address, @jurisdiction, @parcel, @status, @occupancy, @stop_work, @valuation, @sq_ft, @units, @neighborhood, @council, @cra, @issued_date, @created_date, @source_updated, @link, @cluster_key, @score, @score_reasons, @now, @now)`);
  const updStmt = db.prepare(`UPDATE permits SET raw_json=@raw_json, record_type=@record_type, type2=@type2, description=@description, address=@address, jurisdiction=@jurisdiction, parcel=@parcel, status=@status, occupancy=@occupancy, stop_work=@stop_work, valuation=@valuation, sq_ft=@sq_ft, units=@units, neighborhood=@neighborhood, council=@council, cra=@cra, issued_date=@issued_date, created_date=@created_date, source_updated=@source_updated, link=@link, cluster_key=@cluster_key, score=@score, score_reasons=@score_reasons, last_seen_at=@now, changed_at=@now WHERE uid=@uid`);
  const touchStmt = db.prepare(`UPDATE permits SET last_seen_at=@now WHERE uid=@uid`);
  const verStmt = db.prepare(`INSERT INTO permit_versions (uid, changed_at, diff_json) VALUES (?, ?, ?)`);
  const ing = db.prepare(`INSERT INTO ingests (source, batch_hash, ingested_at) VALUES (?, ?, ?)`).run(source, hash, now);

  db.transaction(() => {
    for (const raw of records) {
      const n = norm(raw);
      if (!n) { skipped++; continue; }
      const isCo = source === "hcfl" && String(raw.CATEGORY ?? "").trim().toUpperCase() === "CO";
      const { score, reasons } = scoreRecord(n, isCo);
      const cluster_key = n.parcel ? `parcel:${n.parcel}` : n.address ? `addr:${normalizeAddress(n.address)}` : n.uid;
      const row = { ...n, source, raw_json: JSON.stringify(raw), cluster_key, score, score_reasons: JSON.stringify(reasons), now };
      const existing = getStmt.get(n.uid) as Record<string, unknown> | undefined;
      if (!existing) { insStmt.run(row); inserted++; continue; }
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const f of TRACKED) {
        const newV = (row as Record<string, unknown>)[f];
        if (newV === "" || newV === null) continue; // blanks never clobber
        if (String(existing[f] ?? "") !== String(newV)) diff[f] = { from: existing[f] ?? null, to: newV };
      }
      if (Object.keys(diff).length) {
        const merged: Record<string, unknown> = { ...row };
        for (const f of TRACKED) if (merged[f] === "" || merged[f] === null) merged[f] = existing[f] ?? merged[f];
        // Re-score on the merged values, so a blank description in a later
        // export doesn't strip the restaurant signals it scored on before.
        const s2 = scoreRecord(merged as unknown as Norm, isCo);
        merged.score = s2.score;
        merged.score_reasons = JSON.stringify(s2.reasons);
        updStmt.run(merged);
        verStmt.run(n.uid, now, JSON.stringify(diff));
        changed++;
      } else { touchStmt.run({ now, uid: n.uid }); unchanged++; }
    }
    db.prepare(`UPDATE ingests SET row_count=?, inserted_count=?, changed_count=?, unchanged_count=? WHERE id=?`)
      .run(records.length, inserted, changed, unchanged, Number(ing.lastInsertRowid));
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(`last_collect_${source}`, now);
  })();

  return { alreadyIngested: false, rowCount: records.length, inserted, changed, unchanged, skipped };
}

// ---------- collection state (drives the browser's incremental queries) ----------

export function collectState() {
  const db = leadsDb();
  const get = (k: string) => (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(k) as { value?: string } | undefined)?.value ?? null;
  // The browser filters each feed by its change timestamp; overlap a day so
  // late edits are never missed (dedupe absorbs the repeats).
  const sinceFor = (k: string) => {
    const last = get(k);
    const base = last ? Date.parse(last) - 86400_000 : Date.now() - leadsConfig().initialWindowDays * 86400_000;
    return new Date(base).toISOString().slice(0, 10);
  };
  return {
    tampa: { lastCollect: get("last_collect_tampa"), since: sinceFor("last_collect_tampa") },
    hcfl: { lastCollect: get("last_collect_hcfl"), since: sinceFor("last_collect_hcfl") },
  };
}

// ---------- queue ----------

export type QueueFilter = { sinceDays?: number; onlyNew?: boolean; onlyChanged?: boolean; restaurants?: boolean; development?: boolean; minScore?: number; source?: SourceId };

const RESTAURANT_RE = /restaurant|cafe|café|coffee|\bbar\b|brewery|taproom|pizza|grill|kitchen|hood|grease|ansul|drive.?thr|assembly|food/i;
const DEVELOPMENT_RE = /new construction|addition|demolition|mixed.?use|multifamily|multi-family|apartments|hotel|tower|warehouse/i;

export function getQueue(f: QueueFilter = {}) {
  const db = leadsDb();
  const since = new Date(Date.now() - (f.sinceDays ?? 7) * 86400_000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM permits WHERE cluster_key IN (
      SELECT DISTINCT cluster_key FROM permits
      WHERE first_seen_at >= @since OR (changed_at IS NOT NULL AND changed_at >= @since)
    )`).all({ since }) as Record<string, unknown>[];

  const clusters = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const k = String(r.cluster_key);
    (clusters.get(k) ?? clusters.set(k, []).get(k)!).push(r);
  }
  const cfg = leadsConfig();

  // Human-readable "what changed" for permits changed in the window, from the
  // newest version diff. "Status: In Review -> Issued" is the story signal;
  // a bare CHANGED tag tells a reporter nothing.
  const FIELD_LABELS: Record<string, string> = {
    status: "Status", description: "Description", valuation: "Valuation",
    stop_work: "Stop work", record_type: "Type", address: "Address",
    occupancy: "Occupancy", sq_ft: "Sq ft", units: "Units", issued_date: "Issued date", link: "Link",
  };
  const fmtVal = (f: string, v: unknown) => {
    if (v === null || v === "" || v === undefined) return "(blank)";
    if (f === "valuation") return "$" + Math.round(Number(v)).toLocaleString("en-US");
    if (f === "stop_work") return Number(v) === 1 ? "YES" : "no";
    return String(v).length > 60 ? String(v).slice(0, 60) + "…" : String(v);
  };
  const latestDiffStmt = db.prepare(`SELECT diff_json FROM permit_versions WHERE uid = ? ORDER BY id DESC LIMIT 1`);
  const describeChange = (uid: string): string => {
    const row = latestDiffStmt.get(uid) as { diff_json?: string } | undefined;
    if (!row?.diff_json) return "";
    try {
      const diff = JSON.parse(row.diff_json) as Record<string, { from: unknown; to: unknown }>;
      return Object.entries(diff)
        .filter(([f]) => f !== "source_updated" && f !== "link")
        .map(([f, d]) => `${FIELD_LABELS[f] ?? f}: ${fmtVal(f, d.from)} -> ${fmtVal(f, d.to)}`)
        .slice(0, 3).join(" · ");
    } catch { return ""; }
  };
  const leads = [];
  for (const [clusterKey, permits] of clusters) {
    const sorted = [...permits].sort((a, b) => Number(b.score) - Number(a.score));
    const top = sorted[0];
    const isNew = permits.some(p => String(p.first_seen_at) >= since);
    const isChanged = permits.some(p => p.changed_at && String(p.changed_at) >= since);
    const reasons: [number, string][] = [];
    const seen = new Set<string>();
    for (const p of sorted) {
      let rs: [number, string][] = [];
      try { rs = JSON.parse(String(p.score_reasons || "[]")); } catch {}
      for (const r of rs) if (!seen.has(r[1])) { seen.add(r[1]); reasons.push(r); }
    }
    const hay = permits.map(p => `${p.record_type} ${p.type2} ${p.description} ${p.occupancy}`).join(" ");
    const lead = {
      clusterKey,
      address: String(top.address ?? ""),
      jurisdiction: String(top.jurisdiction ?? ""),
      parcel: String(top.parcel ?? ""),
      firstSeen: permits.map(p => String(p.first_seen_at)).sort()[0],
      permitCount: permits.length,
      topScore: Number(top.score ?? 0),
      isNew, isChanged,
      reasons: reasons.sort((a, b) => b[0] - a[0]).slice(0, 8),
      context: null as null | { owner: string; dba: string; justValue: number | null; saleAmt: number | null; saleDate: string; yearBuilt: number | null },
      contextChecked: false,
      permits: sorted.slice(0, 12).map(p => ({
        uid: String(p.uid), permitNo: String(p.permit_no), source: String(p.source),
        recordType: String(p.record_type || p.type2 || ""), description: String(p.description ?? "").slice(0, 220),
        status: String(p.status ?? ""), valuation: (p.valuation as number | null) ?? null,
        stopWork: Number(p.stop_work ?? 0) === 1, link: String(p.link ?? ""),
        firstSeenAt: String(p.first_seen_at), changedAt: p.changed_at ? String(p.changed_at) : null,
        whatChanged: p.changed_at && String(p.changed_at) >= since ? describeChange(String(p.uid)) : "",
      })),
    };
    if (f.onlyNew && !lead.isNew) continue;
    if (f.onlyChanged && !lead.isChanged) continue;
    if (f.minScore != null && lead.topScore < f.minScore) continue;
    if (f.restaurants && !RESTAURANT_RE.test(hay)) continue;
    // Development is the "big real estate, minus food" pile: anything
    // restaurant-flagged lives under the Restaurants chip instead, so the
    // two filters never overlap.
    if (f.development && (!DEVELOPMENT_RE.test(hay) || RESTAURANT_RE.test(hay))) continue;
    if (f.source && !permits.some(p => p.source === f.source)) continue;
    leads.push(lead);
  }
  leads.sort((a, b) => b.topScore - a.topScore || b.firstSeen.localeCompare(a.firstSeen));
  // Attach stored parcel context (owner, DBA, values, last sale) to each lead.
  const keys = leads.slice(0, 200).map(l => l.clusterKey);
  const ctxMap = getContexts(keys);
  const checked = contextCheckedKeys(keys);
  for (const l of leads) {
    l.contextChecked = checked.has(l.clusterKey);
    const c = ctxMap.get(l.clusterKey);
    if (c && (c.owner || c.dba || c.just_value != null)) {
      l.context = {
        owner: String(c.owner ?? ""), dba: String(c.dba ?? "").trim(),
        justValue: (c.just_value as number | null) ?? null,
        saleAmt: (c.sale_amt as number | null) ?? null, saleDate: String(c.sale_date ?? ""),
        yearBuilt: (c.year_built as number | null) ?? null,
      };
    }
  }
  return {
    leads: leads.slice(0, 200),
    total: leads.length,
    bands: {
      high: leads.filter(l => l.topScore >= cfg.highPriorityMin).length,
      watch: leads.filter(l => l.topScore >= cfg.watchMin && l.topScore < cfg.highPriorityMin).length,
    },
  };
}

// ---------- parcel context (HCPA_Parcels_All enrichment) ----------

export type ParcelContext = {
  clusterKey: string; owner?: string; dba?: string; folio?: string;
  justValue?: number | null; saleAmt?: number | null; saleDate?: string;
  yearBuilt?: number | null; useCode?: string; siteAddr?: string;
};

// Saved by the panel after it queries the Property Appraiser's public parcel
// layer in the browser. An entry with empty fields still records "looked, not
// found" so the panel doesn't retry every load.
export function saveContexts(items: ParcelContext[]): number {
  const db = leadsDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`INSERT INTO contexts (cluster_key, owner, dba, folio, just_value, sale_amt, sale_date, year_built, use_code, site_addr, fetched_at)
    VALUES (@clusterKey, @owner, @dba, @folio, @justValue, @saleAmt, @saleDate, @yearBuilt, @useCode, @siteAddr, @now)
    ON CONFLICT(cluster_key) DO UPDATE SET owner=excluded.owner, dba=excluded.dba, folio=excluded.folio, just_value=excluded.just_value, sale_amt=excluded.sale_amt, sale_date=excluded.sale_date, year_built=excluded.year_built, use_code=excluded.use_code, site_addr=excluded.site_addr, fetched_at=excluded.fetched_at`);
  let n = 0;
  const tx = db.transaction(() => {
    for (const it of items) {
      if (!it.clusterKey) continue;
      stmt.run({
        clusterKey: it.clusterKey, owner: it.owner ?? "", dba: it.dba ?? "", folio: it.folio ?? "",
        justValue: it.justValue ?? null, saleAmt: it.saleAmt ?? null, saleDate: it.saleDate ?? "",
        yearBuilt: it.yearBuilt ?? null, useCode: it.useCode ?? "", siteAddr: it.siteAddr ?? "", now,
      });
      n++;
    }
  });
  tx();
  return n;
}

export function contextCheckedKeys(clusterKeys: string[]): Set<string> {
  const db = leadsDb();
  const out = new Set<string>();
  const stmt = db.prepare(`SELECT cluster_key FROM contexts WHERE cluster_key = ?`);
  for (const k of clusterKeys) if (stmt.get(k)) out.add(k);
  return out;
}

export function getContexts(clusterKeys: string[]): Map<string, Record<string, unknown>> {
  const db = leadsDb();
  const out = new Map<string, Record<string, unknown>>();
  const stmt = db.prepare(`SELECT * FROM contexts WHERE cluster_key = ?`);
  for (const k of clusterKeys) {
    const r = stmt.get(k) as Record<string, unknown> | undefined;
    if (r) out.set(k, r);
  }
  return out;
}
