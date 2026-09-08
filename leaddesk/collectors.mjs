import { config } from "./config.mjs";
import { csvToObjects, importRecords } from "./pipeline.mjs";

// Collectors, in preference order. Both are legitimate public endpoints:
//  1. arcgis  — the City of Tampa's own GIS server (Planning/PermitsAll),
//               JSON, city-run, no WAF between us and the data.
//  2. civicdata — the city's CKAN open-data mirror (CSV, BLDS standard).
// Whichever succeeds feeds the same import pipeline.

const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; TampaLeadDesk/1.0; +https://www.gangrey.org)",
  accept: "application/json, text/csv, */*",
};

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r.json();
}

// Page through an ArcGIS FeatureServer layer's attributes.
async function arcgisLayerRecords(layerUrl) {
  const records = [];
  let offset = 0;
  for (let page = 0; page < 200; page++) {           // hard stop: 200 pages
    const q = `${layerUrl}/query?where=1%3D1&outFields=*&returnGeometry=false&f=json&resultOffset=${offset}&resultRecordCount=2000`;
    const data = await getJson(q);
    if (data.error) throw new Error(`ArcGIS error: ${data.error.message ?? JSON.stringify(data.error)}`);
    const feats = data.features ?? [];
    for (const f of feats) if (f.attributes) records.push(f.attributes);
    if (!data.exceededTransferLimit && feats.length < 2000) break;
    offset += feats.length;
    if (feats.length === 0) break;
  }
  return records;
}

export async function collectArcgis() {
  const cfg = config();
  const meta = await getJson(`${cfg.arcgisBase}?f=json`);
  const layers = (meta.layers ?? []).map(l => l.id);
  if (!layers.length) throw new Error("No layers on the ArcGIS service");
  const records = [];
  for (const id of layers) records.push(...await arcgisLayerRecords(`${cfg.arcgisBase}/${id}`));
  if (!records.length) throw new Error("ArcGIS returned no records");
  const day = new Date().toISOString().slice(0, 10);
  return importRecords(records, Buffer.from(JSON.stringify(records)), `arcgis-permitsall-${day}.json`, "arcgis");
}

export async function collectCivicdata() {
  const cfg = config();
  const meta = await getJson(`${cfg.ckanBase}/api/3/action/package_show?id=${encodeURIComponent(cfg.ckanDatasetId)}`);
  const csv = (meta.result?.resources ?? [])
    .filter(r => (r.format ?? "").toLowerCase() === "csv" && r.url)
    .sort((a, b) => String(b.last_modified ?? "").localeCompare(String(a.last_modified ?? "")))[0];
  if (!csv?.url) throw new Error("No CSV resource on the CKAN dataset");
  const r = await fetch(csv.url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} downloading the CSV`);
  const buf = Buffer.from(await r.arrayBuffer());
  const records = csvToObjects(buf.toString("utf8"));
  const name = (csv.name || csv.url.split("/").pop() || "tampa-permits.csv").slice(0, 120);
  return importRecords(records, buf, name, "civicdata");
}

// Try each collector in order; report which worked or every failure.
export async function collect() {
  const failures = [];
  for (const [name, fn] of [["arcgis", collectArcgis], ["civicdata", collectCivicdata]]) {
    try {
      const summary = await fn();
      return { ...summary, collector: name, failures };
    } catch (e) {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`Every collector failed — ${failures.join("; ")}`);
}
