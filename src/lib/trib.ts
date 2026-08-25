// tampatrib: fetch + cache + radar helpers, ported from the original PHP
// sub-site. Server-side only.
import { WATCHLIST, BIG_SALE, NOMINAL_MAX, DEED_DAYS, CACHE_TTL } from "@/app/trib/config";

const UA = "Mozilla/5.0 (Macintosh) tampatrib-subsite/1.0";

// ---- fetch + cache -----------------------------------------------------
// In-memory, per-process (a single long-lived container serves the site).
// Stale-on-error like the original: a failed refresh serves the last good
// copy with a note instead of an empty section.
type CacheEntry = { at: number; data: Record<string, unknown> };
const mem = new Map<string, CacheEntry>();

async function http(url: string, opts: { headers?: Record<string, string>; json?: unknown } = {}): Promise<string> {
  const res = await fetch(url, {
    method: opts.json !== undefined ? "POST" : "GET",
    headers: { "User-Agent": UA, ...(opts.json !== undefined ? { "Content-Type": "application/json; charset=UTF-8" } : {}), ...opts.headers },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function cached(key: string, fn: () => Promise<Record<string, unknown>>, force = false): Promise<Record<string, unknown>> {
  const hit = mem.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL * 1000) return hit.data;
  try {
    const data = await fn();
    mem.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (hit) return { ...hit.data, _stale: msg };
    return { _error: msg };
  }
}

// ---- sources -----------------------------------------------------------
export type DeedRow = { instrument: string; date: string; from: string; to: string; price: number; legal: string };

export async function fetchDeeds(): Promise<{ rows: DeedRow[]; truncated?: unknown }> {
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const begin = new Date(Date.now() - DEED_DAYS * 86400_000);
  const body = await http("https://publicaccess.hillsclerk.com/Public/ORIUtilities/DocumentSearch/api/Search", {
    json: {
      DocType: ["(D) DEED"],
      RecordDateBegin: fmt(begin),
      RecordDateEnd: fmt(new Date()),
    },
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://publicaccess.hillsclerk.com",
      "Referer": "https://publicaccess.hillsclerk.com/oripublicaccess/",
      "Accept": "application/json, text/javascript, */*; q=0.01",
    },
  });
  const j = JSON.parse(body);
  if (!j?.Success) throw new Error(j?.ErrorMessage || "Clerk API error");
  const rows: DeedRow[] = (j.ResultList ?? []).map((r: Record<string, unknown>) => ({
    instrument: String(r.Instrument ?? ""),
    date: r.RecordDate ? new Date(Number(r.RecordDate)).toISOString().slice(0, 10) : "",
    from: ((r.PartiesOne as string[]) ?? []).join("; "),
    to: ((r.PartiesTwo as string[]) ?? []).join("; "),
    price: Number(r.SalesPrice ?? 0),
    legal: String(r.Legal ?? ""),
  }));
  rows.sort((a, b) => b.price - a.price);
  return { rows, truncated: j.Truncated ?? null };
}


export type NwsAlert = { event: string; headline: string; severity: string; url: string; geometry?: unknown };

export async function fetchNws(): Promise<{ items: NwsAlert[] }> {
  const j = JSON.parse(await http("https://api.weather.gov/alerts/active?area=FL", {
    headers: { Accept: "application/geo+json" },
  }));
  const items: NwsAlert[] = [];
  for (const f of j?.features ?? []) {
    const p = f.properties ?? {};
    // Hillsborough County (and Tampa) only.
    if (!/Hillsborough|Tampa/i.test(p.areaDesc ?? "")) continue;
    items.push({
      event: p.event ?? "", headline: p.headline ?? "",
      severity: String(p.severity ?? "").toLowerCase(), url: p["@id"] ?? "",
      // Real polygon geometry when the alert carries one, for the map.
      geometry: f.geometry ?? undefined,
    });
  }
  return { items };
}

// ---- geocoding ---------------------------------------------------------
// Clerk deeds carry legal descriptions, not addresses. Best effort: strip the
// lot/block/unit noise down to the subdivision name and ask OSM's Photon
// geocoder, biased hard to Hillsborough County. Hits and misses are both
// cached for a week so each legal costs at most one lookup ever per process.
const HILLS_BBOX = "-82.82,27.57,-81.95,28.28"; // lon1,lat1,lon2,lat2 around the county
const geoCache = new Map<string, { at: number; pt: [number, number] | null }>();
const GEO_TTL = 7 * 86400_000;

function legalToQuery(legal: string): string | null {
  const q = legal
    .toUpperCase()
    .replace(/\b(LOTS?|LT|BLOCKS?|BLK|UNITS?|BLDG|BUILDING|PHASE|PH|SEC(TION)?|TWP|TOWNSHIP|RGE?|RANGE|PB|PG|PAGE|PLAT|BOOK|OR|A?K?A)\b[\s.]*[0-9A-Z-]*/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = q.split(" ").filter(w => w.length > 2).slice(0, 5);
  return words.length >= 2 ? words.join(" ") : null;
}

export async function geocodeLegal(legal: string): Promise<[number, number] | null> {
  const q = legalToQuery(legal);
  if (!q) return null;
  const hit = geoCache.get(q);
  if (hit && Date.now() - hit.at < GEO_TTL) return hit.pt;
  try {
    const j = JSON.parse(await http(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q + " Hillsborough County Florida")}&limit=1&bbox=${HILLS_BBOX}`
    ));
    const c = j?.features?.[0]?.geometry?.coordinates;
    const pt: [number, number] | null = Array.isArray(c) ? [Number(c[1]), Number(c[0])] : null;
    // Sanity: inside the county-ish bbox or it does not count.
    const ok = pt && pt[0] > 27.5 && pt[0] < 28.35 && pt[1] > -82.9 && pt[1] < -81.9;
    geoCache.set(q, { at: Date.now(), pt: ok ? pt : null });
    return ok ? pt : null;
  } catch {
    geoCache.set(q, { at: Date.now(), pt: null });
    return null;
  }
}

// Geocode the first `budget` un-cached rows (cached ones are free), a few at
// a time, so a cold load stays quick and the map fills in across reloads.
export async function geolocateDeeds(rows: DeedRow[], budget = 25): Promise<Record<string, [number, number]>> {
  const out: Record<string, [number, number]> = {};
  let spent = 0;
  const queue: DeedRow[] = [];
  for (const d of rows) {
    const q = d.legal ? legalToQuery(d.legal) : null;
    if (!q) continue;
    const hit = geoCache.get(q);
    if (hit && Date.now() - hit.at < GEO_TTL) { if (hit.pt) out[d.instrument] = hit.pt; continue; }
    if (spent < budget) { queue.push(d); spent++; }
  }
  const CONC = 4;
  for (let i = 0; i < queue.length; i += CONC) {
    await Promise.all(queue.slice(i, i + CONC).map(async d => {
      const pt = await geocodeLegal(d.legal);
      if (pt) out[d.instrument] = pt;
    }));
  }
  return out;
}

// ---- radar -------------------------------------------------------------
export function watchHit(text: string): string | null {
  const lower = text.toLowerCase();
  for (const t of WATCHLIST) if (t && lower.includes(t.toLowerCase())) return t;
  return null;
}

export function deedBadges(d: DeedRow): [string, string][] {
  const b: [string, string][] = [];
  if (d.price >= BIG_SALE) b.push([`💰 ${(d.price / 1e6).toFixed(1)}M`, "big"]);
  if (d.price > NOMINAL_MAX && /\b(LLC|L\.L\.C|CORP|INC|TRUST|LP|HOLDINGS?)\b/i.test(d.to)) b.push(["🏢 entity buyer", "ent"]);
  if (d.price <= NOMINAL_MAX) b.push(["↔ nominal transfer", "nom"]);
  const w = watchHit(`${d.from} ${d.to} ${d.legal}`);
  if (w) b.push([`🚩 ${w}`, "flag"]);
  return b;
}
