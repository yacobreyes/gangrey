import { scoopConfig } from "./config";
import { scoopDb } from "./db";

export type Lead = {
  clusterKey: string;
  address: string;
  parcel: string;
  projectName: string;
  firstSeen: string;      // earliest first_seen_at in the cluster
  lastActivity: string;
  permitCount: number;
  topScore: number;
  isNew: boolean;         // any permit first seen in the window
  isChanged: boolean;     // any permit changed in the window
  reasons: [number, string][]; // deduped, from the highest-scoring permit(s)
  permits: {
    permitId: string; recordType: string; description: string; status: string;
    appliedDate: string; valuation: number | null; score: number;
    firstSeenAt: string; changedAt: string | null; link: string;
  }[];
};

export type LeadsFilter = {
  sinceDays?: number;      // activity window (default 7)
  onlyNew?: boolean;
  onlyChanged?: boolean;
  restaurants?: boolean;
  development?: boolean;
  minScore?: number;
};

const RESTAURANT_RE = /restaurant|cafe|café|coffee|\bbar\b|brewery|taproom|pizza|grill|kitchen|hood|grease|ansul|drive.?thr/i;
const DEVELOPMENT_RE = /new construction|addition|demolition|site|mixed.?use|multifamily|multi-family|apartments|hotel|tower/i;

// The reporting queue: permits clustered into projects, ranked by score.
export function getLeads(f: LeadsFilter = {}): Lead[] {
  const db = scoopDb();
  const since = new Date(Date.now() - (f.sinceDays ?? 7) * 86400_000).toISOString();
  // Pull every permit in clusters that had any activity in the window: the
  // active permit is the lead, but its siblings give the project its shape.
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

  const leads: Lead[] = [];
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
    const hay = permits.map(p => `${p.record_type} ${p.description} ${p.project_name}`).join(" ");
    const lead: Lead = {
      clusterKey,
      address: String(top.address ?? ""),
      parcel: String(top.parcel ?? ""),
      projectName: String(permits.map(p => p.project_name).find(Boolean) ?? ""),
      firstSeen: permits.map(p => String(p.first_seen_at)).sort()[0],
      lastActivity: permits.map(p => String(p.changed_at ?? p.first_seen_at)).sort().slice(-1)[0],
      permitCount: permits.length,
      topScore: Number(top.score ?? 0),
      isNew, isChanged,
      reasons: reasons.sort((a, b) => b[0] - a[0]).slice(0, 8),
      permits: sorted.map(p => ({
        permitId: String(p.permit_id), recordType: String(p.record_type ?? ""),
        description: String(p.description ?? ""), status: String(p.status ?? ""),
        appliedDate: String(p.applied_date ?? ""), valuation: (p.valuation as number | null) ?? null,
        score: Number(p.score ?? 0), firstSeenAt: String(p.first_seen_at),
        changedAt: p.changed_at ? String(p.changed_at) : null, link: String(p.link ?? ""),
      })),
    };
    if (f.onlyNew && !lead.isNew) continue;
    if (f.onlyChanged && !lead.isChanged) continue;
    if (f.minScore != null && lead.topScore < f.minScore) continue;
    if (f.restaurants && !RESTAURANT_RE.test(hay)) continue;
    if (f.development && !DEVELOPMENT_RE.test(hay)) continue;
    leads.push(lead);
  }
  return leads.sort((a, b) => b.topScore - a.topScore || b.lastActivity.localeCompare(a.lastActivity));
}

export function lastImports(limit = 10) {
  return scoopDb().prepare(`SELECT * FROM imports ORDER BY imported_at DESC LIMIT ?`).all(limit);
}

export function queueBands(leads: Lead[]) {
  const cfg = scoopConfig();
  return {
    high: leads.filter(l => l.topScore >= cfg.highPriorityMin).length,
    watch: leads.filter(l => l.topScore >= cfg.watchMin && l.topScore < cfg.highPriorityMin).length,
  };
}
