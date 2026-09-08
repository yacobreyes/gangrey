import { collectState, ingestRecords, leadsDb, type SourceId } from "./store";

// Server-side collection for the feeds the VPS can reach. Verified: the box
// gets HTTP 200 from services.arcgis.com (Esri cloud), which hosts both
// county feeds. The Tampa feeds (arcgis.tampagov.net) 403 datacenter IPs and
// stay browser-collected from the Lead Desk panel. Same incremental logic as
// the panel: DATE filter on the feed's change field, newest-first scan as
// the fallback, one-day overlap absorbed by dedupe.
const SERVER_FEEDS: Record<"hcfl" | "hcdev", { layer: string; dateField: string }> = {
  hcfl: {
    layer: "https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer/0",
    dateField: "COMBINED_DATE",
  },
  hcdev: {
    layer: "https://services.arcgis.com/apTfC6SUmnNfnxuF/ArcGIS/rest/services/Site-Subdivision_DevReview_View/FeatureServer/0",
    dateField: "EditDate",
  },
};

const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; SunlandLeadDesk/1.0; +https://www.gangrey.org)", accept: "application/json" };

async function queryPage(layer: string, where: string, orderBy: string, offset: number) {
  const url = `${layer}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=false&orderByFields=${encodeURIComponent(orderBy)}&resultOffset=${offset}&resultRecordCount=2000&f=json`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json() as { error?: { message?: string }; features?: { attributes?: Record<string, unknown> }[]; exceededTransferLimit?: boolean };
  if (data.error) throw new Error(data.error.message || "query error");
  return data;
}

export async function collectFeedOnServer(id: "hcfl" | "hcdev", since: string): Promise<string> {
  const feed = SERVER_FEEDS[id];
  const records: Record<string, unknown>[] = [];
  const sinceMs = Date.parse(since + "T00:00:00Z");
  try {
    for (let offset = 0, page = 0; page < 100; page++) {
      const data = await queryPage(feed.layer, `${feed.dateField} >= DATE '${since}'`, "OBJECTID ASC", offset);
      const feats = data.features ?? [];
      for (const f of feats) if (f.attributes) records.push(f.attributes);
      if (feats.length < 2000 && !data.exceededTransferLimit) break;
      if (feats.length === 0 || records.length >= 48_000) break;
      offset += feats.length;
    }
  } catch {
    records.length = 0;
    for (let offset = 0, page = 0; page < 30; page++) {
      const data = await queryPage(feed.layer, "1=1", `${feed.dateField} DESC`, offset);
      const feats = data.features ?? [];
      let reachedOld = false;
      for (const f of feats) {
        const a = f.attributes;
        if (!a) continue;
        const ts = Number(a[feed.dateField]);
        if (Number.isFinite(ts) && ts > 1e11 && ts < sinceMs) { reachedOld = true; break; }
        records.push(a);
      }
      if (reachedOld || feats.length === 0 || records.length >= 48_000) break;
      offset += feats.length;
    }
  }
  if (!records.length) {
    leadsDb().prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(`last_collect_${id}`, new Date().toISOString());
    return `${id}: nothing new`;
  }
  const s = ingestRecords(id as SourceId, records);
  return s.alreadyIngested ? `${id}: already imported` : `${id}: ${s.inserted} new, ${s.changed} changed, ${s.unchanged} unchanged`;
}

// Called from the 5-minute publish cron; runs at most once per ~20 hours per
// feed, so the county feeds collect themselves daily with no extra setup.
export async function maybeCollectLeadsOnServer(): Promise<string[]> {
  const state = collectState();
  const out: string[] = [];
  for (const id of ["hcdev", "hcfl"] as const) {
    const last = state[id]?.lastCollect;
    if (last && Date.now() - Date.parse(last) < 20 * 3600 * 1000) continue;
    try { out.push(await collectFeedOnServer(id, state[id].since)); }
    catch (e) { out.push(`${id}: failed (${e instanceof Error ? e.message : e})`); }
  }
  return out;
}
