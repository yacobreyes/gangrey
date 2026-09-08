import crypto from "crypto";
import fs from "fs";
import path from "path";
import { parseCsv } from "./csv";
import { scoopConfig } from "./config";
import { scoopDb, rawReportDir } from "./db";

export type ImportSummary = {
  alreadyImported: boolean;
  importId?: number;
  filename: string;
  rowCount: number;
  inserted: number;
  changed: number;
  unchanged: number;
  errors: number;
  reportStart?: string;
  reportEnd?: string;
  columns?: string[];
};

// Header key: lowercase, spaces/underscores/punctuation stripped, so
// "Applied Date", "applied_date" and "APPLIEDDATE" all match one candidate.
const keyOf = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function buildHeaderIndex(headers: string[]): Map<string, number> {
  const idx = new Map<string, number>();
  headers.forEach((h, i) => { if (!idx.has(keyOf(h))) idx.set(keyOf(h), i); });
  return idx;
}

function pick(idx: Map<string, number>, row: string[], candidates: string[]): string {
  for (const c of candidates) {
    const i = idx.get(keyOf(c));
    if (i !== undefined && row[i] !== undefined && row[i] !== "") return String(row[i]).trim();
  }
  return "";
}

function parseValuation(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Normalize an address into a cluster key: uppercase, drop unit/suite noise,
// collapse whitespace. Parcel wins when present (set by the caller).
export function normalizeAddress(addr: string): string {
  return addr
    .toUpperCase()
    .replace(/\b(STE|SUITE|UNIT|APT|#)\s*\S*/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreRecord(recordType: string, description: string, projectName: string, valuation: number | null): { score: number; reasons: [number, string][] } {
  const cfg = scoopConfig();
  const hay = `${recordType} ${description} ${projectName}`.toLowerCase();
  const reasons: [number, string][] = [];
  const apply = (signals: [string, number, string][]) => {
    for (const [pattern, points, label] of signals) {
      try { if (new RegExp(pattern, "i").test(hay)) reasons.push([points, label]); } catch { /* bad pattern in config */ }
    }
  };
  apply(cfg.typeSignals);
  apply(cfg.keywordSignals);
  apply(cfg.brandSignals);
  if (valuation != null) {
    const tier = cfg.valuationTiers.find(t => valuation >= t.min);
    if (tier) reasons.push([tier.points, tier.label]);
  }
  return { score: reasons.reduce((s, [p]) => s + p, 0), reasons };
}

// Fields whose change is worth versioning + resurfacing in the queue.
const TRACKED = ["record_type", "description", "project_name", "address", "parcel", "status", "applied_date", "issued_date", "valuation", "contractor", "applicant", "owner"] as const;

// Ingest one report file (CSV). Preserves the original bytes under
// data/raw/tampa_daily_permits/YYYY-MM-DD/, dedupes whole files by hash and
// rows by the city's permit identifier, versions changes, scores and clusters.
export function importReport(buf: Buffer, filename: string, source: "civicdata" | "manual"): ImportSummary {
  const db = scoopDb();
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const dupe = db.prepare(`SELECT id FROM imports WHERE file_hash = ?`).get(hash) as { id: number } | undefined;
  if (dupe) return { alreadyImported: true, filename, rowCount: 0, inserted: 0, changed: 0, unchanged: 0, errors: 0 };

  const now = new Date().toISOString();
  // Preserve the original file first — never process a report we didn't keep.
  // Suffix with the short hash so two different files named identically on the
  // same day can never overwrite each other.
  const dir = rawReportDir(now);
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_") || "report.csv";
  fs.writeFileSync(path.join(dir, `${hash.slice(0, 12)}-${safeName}`), buf);

  const rows = parseCsv(buf.toString("utf8"));
  if (rows.length < 2) {
    const info = db.prepare(`INSERT INTO imports (source, filename, file_hash, imported_at, row_count, error_count) VALUES (?, ?, ?, ?, 0, 1)`).run(source, filename, hash, now);
    return { alreadyImported: false, importId: Number(info.lastInsertRowid), filename, rowCount: 0, inserted: 0, changed: 0, unchanged: 0, errors: 1 };
  }

  const headers = rows[0];
  const idx = buildHeaderIndex(headers);
  const fm = scoopConfig().fieldMap;

  let inserted = 0, changed = 0, unchanged = 0, errors = 0;
  let minDate = "", maxDate = "";

  const getStmt = db.prepare(`SELECT * FROM permits WHERE permit_id = ?`);
  const insStmt = db.prepare(`INSERT INTO permits (permit_id, raw_json, record_type, description, project_name, address, parcel, status, applied_date, issued_date, valuation, contractor, applicant, owner, link, cluster_key, score, score_reasons, first_seen_at, last_seen_at, first_import_id, last_import_id)
    VALUES (@permit_id, @raw_json, @record_type, @description, @project_name, @address, @parcel, @status, @applied_date, @issued_date, @valuation, @contractor, @applicant, @owner, @link, @cluster_key, @score, @score_reasons, @now, @now, @import_id, @import_id)`);
  const updStmt = db.prepare(`UPDATE permits SET raw_json=@raw_json, record_type=@record_type, description=@description, project_name=@project_name, address=@address, parcel=@parcel, status=@status, applied_date=@applied_date, issued_date=@issued_date, valuation=@valuation, contractor=@contractor, applicant=@applicant, owner=@owner, link=@link, cluster_key=@cluster_key, score=@score, score_reasons=@score_reasons, last_seen_at=@now, changed_at=@now, last_import_id=@import_id WHERE permit_id=@permit_id`);
  const touchStmt = db.prepare(`UPDATE permits SET last_seen_at=@now, last_import_id=@import_id WHERE permit_id=@permit_id`);
  const verStmt = db.prepare(`INSERT INTO permit_versions (permit_id, import_id, changed_at, diff_json) VALUES (?, ?, ?, ?)`);

  const importInfo = db.prepare(`INSERT INTO imports (source, filename, file_hash, imported_at) VALUES (?, ?, ?, ?)`).run(source, filename, hash, now);
  const importId = Number(importInfo.lastInsertRowid);

  const tx = db.transaction(() => {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      try {
        const permitId = pick(idx, row, fm.permitId);
        if (!permitId) { errors++; continue; }

        // Raw record: every original column under its original header name.
        const raw: Record<string, string> = {};
        headers.forEach((h, i) => { raw[h] = row[i] ?? ""; });

        const rec = {
          permit_id: permitId,
          raw_json: JSON.stringify(raw),
          record_type: pick(idx, row, fm.recordType),
          description: pick(idx, row, fm.description),
          project_name: pick(idx, row, fm.projectName),
          address: pick(idx, row, fm.address),
          parcel: pick(idx, row, fm.parcel),
          status: pick(idx, row, fm.status),
          applied_date: pick(idx, row, fm.appliedDate).slice(0, 10),
          issued_date: pick(idx, row, fm.issuedDate).slice(0, 10),
          valuation: parseValuation(pick(idx, row, fm.valuation)),
          contractor: pick(idx, row, fm.contractor),
          applicant: pick(idx, row, fm.applicant),
          owner: pick(idx, row, fm.owner),
          link: pick(idx, row, fm.link),
        };
        const { score, reasons } = scoreRecord(rec.record_type, rec.description, rec.project_name, rec.valuation);
        const cluster_key = rec.parcel ? `parcel:${rec.parcel}` : rec.address ? `addr:${normalizeAddress(rec.address)}` : `id:${permitId}`;

        if (rec.applied_date) {
          if (!minDate || rec.applied_date < minDate) minDate = rec.applied_date;
          if (!maxDate || rec.applied_date > maxDate) maxDate = rec.applied_date;
        }

        const existing = getStmt.get(permitId) as Record<string, unknown> | undefined;
        if (!existing) {
          insStmt.run({ ...rec, cluster_key, score, score_reasons: JSON.stringify(reasons), now, import_id: importId });
          inserted++;
        } else {
          const diff: Record<string, { from: unknown; to: unknown }> = {};
          for (const f of TRACKED) {
            const oldV = existing[f] ?? (f === "valuation" ? null : "");
            const newV = (rec as Record<string, unknown>)[f] ?? (f === "valuation" ? null : "");
            // A field going blank in a later report is usually the export
            // omitting it, not the city erasing it — keep the known value.
            if (newV === "" || newV === null) continue;
            if (String(oldV ?? "") !== String(newV)) diff[f] = { from: oldV, to: newV };
          }
          if (Object.keys(diff).length) {
            // Merge: changed fields win, blanks keep the existing value.
            const merged = { ...rec } as Record<string, unknown>;
            for (const f of TRACKED) {
              const v = merged[f];
              if (v === "" || v === null) merged[f] = existing[f] ?? v;
            }
            const s2 = scoreRecord(String(merged.record_type ?? ""), String(merged.description ?? ""), String(merged.project_name ?? ""), (merged.valuation as number | null) ?? null);
            updStmt.run({ ...merged, permit_id: permitId, raw_json: rec.raw_json, cluster_key, score: s2.score, score_reasons: JSON.stringify(s2.reasons), now, import_id: importId });
            verStmt.run(permitId, importId, now, JSON.stringify(diff));
            changed++;
          } else {
            touchStmt.run({ now, import_id: importId, permit_id: permitId });
            unchanged++;
          }
        }
      } catch { errors++; }
    }
    db.prepare(`UPDATE imports SET row_count=?, inserted_count=?, changed_count=?, unchanged_count=?, error_count=?, report_start_date=?, report_end_date=? WHERE id=?`)
      .run(rows.length - 1, inserted, changed, unchanged, errors, minDate || null, maxDate || null, importId);
  });
  tx();

  return { alreadyImported: false, importId, filename, rowCount: rows.length - 1, inserted, changed, unchanged, errors, reportStart: minDate, reportEnd: maxDate, columns: headers };
}

// Column report for docs/TAMPA_DAILY_PERMIT_REPORT.md: every original header
// with fill rate and sample values, straight from stored raw rows.
export function schemaReport(sampleSize = 500): { column: string; filled: number; total: number; samples: string[] }[] {
  const db = scoopDb();
  const rows = db.prepare(`SELECT raw_json FROM permits ORDER BY last_seen_at DESC LIMIT ?`).all(sampleSize) as { raw_json: string }[];
  const cols = new Map<string, { filled: number; samples: Set<string> }>();
  for (const r of rows) {
    let raw: Record<string, string>;
    try { raw = JSON.parse(r.raw_json); } catch { continue; }
    for (const [k, v] of Object.entries(raw)) {
      const c = cols.get(k) ?? { filled: 0, samples: new Set<string>() };
      if (v !== "" && v != null) { c.filled++; if (c.samples.size < 5) c.samples.add(String(v).slice(0, 80)); }
      cols.set(k, c);
    }
  }
  return [...cols.entries()].map(([column, c]) => ({ column, filled: c.filled, total: rows.length, samples: [...c.samples] }));
}
