// tampatrib: fetch + cache + radar helpers, ported from the original PHP
// sub-site. Server-side only.
import { WATCHLIST, BIG_SALE, NOMINAL_MAX, DEED_DAYS, CACHE_TTL, DISTRESS_DOCTYPE_CANDIDATES, WARN_URLS } from "@/app/trib/config";

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

// ---- meetings ----------------------------------------------------------
// Tampa City Council: OnBase Agenda Online (tampa.gov/agendas redirects
// here). Hillsborough BOCC: the county's agendas page. Both are HTML scrapes
// with generous parsing and stale-on-error caching; when a scrape yields
// nothing the UI still shows the always-working portal links.
export type MeetingItem = { title: string; date: string; url: string };

const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;|&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

export async function fetchTampaMeetings(): Promise<{ items: MeetingItem[] }> {
  const base = "https://tampagov.hylandcloud.com/221agendaonline";
  // The instance 404s on /Meetings (verified live); probe the known OnBase
  // AgendaOnline shapes and use the first page that answers with meetings.
  let html = "";
  const tries = [`${base}/Meetings`, `${base}/OnBaseAgendaOnline/Meetings`, base, `${base}/Meetings/Search?dropid=4&mtids=all`];
  let lastErr = "";
  for (const u of tries) {
    try { html = await http(u); if (/ViewMeeting/i.test(html)) break; } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
  }
  if (!/ViewMeeting/i.test(html)) throw new Error(lastErr || "no meetings page found");
  const items: MeetingItem[] = [];
  const re = /<a[^>]+href="([^"]*ViewMeeting[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && items.length < 12) {
    const title = strip(m[2]);
    if (!title) continue;
    // Date rides in the title or the surrounding row on OnBase listings.
    const ctx = html.slice(Math.max(0, m.index - 400), m.index + 400);
    const dm = (title.match(/\d{1,2}\/\d{1,2}\/\d{4}/) ?? ctx.match(/\d{1,2}\/\d{1,2}\/\d{4}/));
    const url = m[1].startsWith("http") ? m[1] : base + (m[1].startsWith("/") ? "" : "/") + m[1].replace(/^\.\//, "");
    if (items.some(i => i.url === url)) continue;
    items.push({ title, date: dm?.[0] ?? "", url });
  }
  if (items.length === 0) throw new Error("no meetings parsed");
  return { items };
}

export async function fetchBoccMeetings(): Promise<{ items: MeetingItem[] }> {
  const html = await http("https://hcfl.gov/government/meeting-information/agendas-recaps-and-minutes");
  const items: MeetingItem[] = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && items.length < 12) {
    const title = strip(m[2]);
    const href = m[1];
    if (!/agenda/i.test(title + " " + href)) continue;
    if (/^#|mailto:/.test(href)) continue;
    const url = href.startsWith("http") ? href : "https://hcfl.gov" + (href.startsWith("/") ? href : "/" + href);
    if (items.some(i => i.url === url)) continue;
    const dm = title.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/i);
    items.push({ title, date: dm?.[0] ?? "", url });
  }
  if (items.length === 0) throw new Error("no agendas parsed");
  return { items };
}

// ---- deed drill-down ---------------------------------------------------
// Other documents recorded for the same party name at the Clerk, so a deed on
// the radar can be chased without leaving the site. Same Search endpoint as
// the deeds pull, searched by name across all doc types.
export async function clerkPartySearch(name: string, years = 5): Promise<{ rows: DeedRow[] }> {
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const begin = new Date(); begin.setFullYear(begin.getFullYear() - years);
  const body = await http("https://publicaccess.hillsclerk.com/Public/ORIUtilities/DocumentSearch/api/Search", {
    json: {
      Name: name,
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
  const rows: DeedRow[] = (j.ResultList ?? []).slice(0, 40).map((r: Record<string, unknown>) => ({
    instrument: String(r.Instrument ?? ""),
    date: r.RecordDate ? new Date(Number(r.RecordDate)).toISOString().slice(0, 10) : "",
    from: ((r.PartiesOne as string[]) ?? []).join("; "),
    to: ((r.PartiesTwo as string[]) ?? []).join("; "),
    price: Number(r.SalesPrice ?? 0),
    legal: String(r.Legal ?? ""),
    docType: String((r as Record<string, unknown>).DocType ?? (r as Record<string, unknown>).DocTypeDescription ?? ""),
  } as DeedRow & { docType?: string }));
  rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { rows };
}

// ---- Tampa ArcGIS layers (zoning / FLU / dev coordination) --------------
// The city publishes these on its own ArcGIS server; the dev-coordination
// locations layer is /OpenData/Planning/MapServer/31 and zoning + future
// land use are siblings in the same service. Layer ids are DISCOVERED from
// the service directory by name, so a renumbering on the city's side fixes
// itself on the next cache cycle.
const TAMPA_PLANNING = "https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Planning/MapServer";

export type GisLayer = { id: number; name: string; key: string };

const LAYER_WANTS: [string, RegExp][] = [
  ["zoning", /zoning\s*district/i],
  ["flu", /future\s*land\s*use/i],
  ["devcoord", /development\s*coordination/i],
  ["cra", /community\s*redevelopment/i],
  ["council", /council\s*district/i],
];

const ARCGIS_HEADERS = {
  "Accept": "application/json,text/plain,*/*",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  "Referer": "https://city-tampa.opendata.arcgis.com/",
};

function parseArcgis(body: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  try { return JSON.parse(body); }
  catch { throw new Error(`non-JSON from ArcGIS: ${body.slice(0, 80).replace(/\s+/g, " ")}`); }
}

export async function discoverPlanningLayers(): Promise<{ base: string; layers: GisLayer[] }> {
  const j = parseArcgis(await http(`${TAMPA_PLANNING}?f=pjson`, { headers: ARCGIS_HEADERS }));
  const found: GisLayer[] = [];
  for (const l of j?.layers ?? []) {
    for (const [key, re] of LAYER_WANTS) {
      if (re.test(String(l.name ?? "")) && !found.some(f => f.key === key)) {
        found.push({ id: Number(l.id), name: String(l.name), key });
      }
    }
  }
  // The one id we know from the source page, as a floor if discovery misses it.
  if (!found.some(f => f.key === "devcoord")) found.push({ id: 31, name: "Development Coordination Locations", key: "devcoord" });
  return { base: TAMPA_PLANNING, layers: found };
}

// Development coordination records for the rail list: attributes of the
// current locations layer, newest-ish first, capped.
export async function fetchDevCoord(): Promise<{ items: Record<string, unknown>[]; fields: string[] }> {
  // Discovery is best-effort; the id the Toolshed's own page confirmed (31)
  // is the fallback so this section never depends on the directory call.
  let id = 31;
  try {
    const disc = await discoverPlanningLayers();
    id = disc.layers.find(l => l.key === "devcoord")?.id ?? 31;
  } catch { /* use 31 */ }
  const j = parseArcgis(await http(
    `${TAMPA_PLANNING}/${id}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=100&f=pjson`,
    { headers: ARCGIS_HEADERS }
  ));
  if (j.error) throw new Error(j.error.message || "ArcGIS error");
  const items = (j.features ?? []).map((f: { attributes: Record<string, unknown> }) => f.attributes);
  const fields = (j.fields ?? []).map((f: { name: string }) => f.name);
  return { items, fields };
}

// ---- agenda parsing -----------------------------------------------------
// Turns a meeting page into inline agenda items so the rail can SHOW the
// agenda rather than link to it. Two passes: an OnBase AgendaOnline shape
// (item rows in tables/divs with an item number), then a generic pass
// (list items and paragraph-ish rows), keeping whichever reads best.
export type AgendaItem = { num: string; text: string };

const strip2 = (h: string) => h
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&nbsp;/gi, " ").replace(/&#\d+;|&[a-z]+;/gi, " ")
  .replace(/\s+/g, " ").trim();

export async function parseAgendaPage(url: string): Promise<{ title: string; items: AgendaItem[]; note?: string }> {
  const html = await http(url, { headers: {
    "Accept": "text/html,application/xhtml+xml",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  }});
  const title = strip2((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""));
  const items: AgendaItem[] = [];
  const push = (num: string, text: string) => {
    const t = text.trim();
    if (t.length < 8 || t.length > 1200) return;
    if (items.some(i => i.text === t)) return;
    items.push({ num, text: t });
  };

  // Pass 1: OnBase-ish — table rows whose first cell looks like an item number.
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(strip2);
    if (cells.length < 2) continue;
    const num = cells[0];
    if (!/^[A-Z]?[0-9]{1,3}[.):]?$|^[IVXLC]+\.?$|^[A-Z]\.?$/.test(num)) continue;
    push(num.replace(/[.):]$/, ""), cells.slice(1).join(" — "));
    if (items.length >= 200) break;
  }

  // Pass 2 (only if pass 1 found little): list items and agenda-item divs.
  if (items.length < 3) {
    for (const li of html.match(/<li[\s\S]*?<\/li>/gi) ?? []) {
      const t = strip2(li);
      if (/agenda|resolution|ordinance|approv|public hearing|contract|rezon|variance|budget/i.test(t)) push("", t);
      if (items.length >= 120) break;
    }
  }
  if (items.length < 3) {
    for (const div of html.match(/<(?:div|p)[^>]*class="[^"]*(?:item|agenda)[^"]*"[^>]*>[\s\S]*?<\/(?:div|p)>/gi) ?? []) {
      push("", strip2(div));
      if (items.length >= 120) break;
    }
  }

  return {
    title,
    items,
    ...(items.length === 0 ? { note: "No agenda items recognized on that page; it may be a PDF or an app view." } : {}),
  };
}


// ---- distress radar (lis pendens / foreclosure filings) -----------------
// Same Clerk Search API as the deeds pull. A lis pendens is the first public
// paper of a foreclosure or property fight: an early-warning list.
async function clerkSearchByTypes(docTypes: string[], days: number): Promise<DeedRow[]> {
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const begin = new Date(Date.now() - days * 86400_000);
  const body = await http("https://publicaccess.hillsclerk.com/Public/ORIUtilities/DocumentSearch/api/Search", {
    json: { DocType: docTypes, RecordDateBegin: fmt(begin), RecordDateEnd: fmt(new Date()) },
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://publicaccess.hillsclerk.com",
      "Referer": "https://publicaccess.hillsclerk.com/oripublicaccess/",
      "Accept": "application/json, text/javascript, */*; q=0.01",
    },
  });
  const j = JSON.parse(body);
  if (!j?.Success) throw new Error(j?.ErrorMessage || "Clerk API error");
  return (j.ResultList ?? []).map((r: Record<string, unknown>) => ({
    instrument: String(r.Instrument ?? ""),
    date: r.RecordDate ? new Date(Number(r.RecordDate)).toISOString().slice(0, 10) : "",
    from: ((r.PartiesOne as string[]) ?? []).join("; "),
    to: ((r.PartiesTwo as string[]) ?? []).join("; "),
    price: Number(r.SalesPrice ?? 0),
    legal: String(r.Legal ?? ""),
  }));
}

let distressWinner: string[] | null = null;
export async function fetchDistress(): Promise<{ rows: DeedRow[]; docTypes: string[] }> {
  const tries = distressWinner ? [distressWinner] : DISTRESS_DOCTYPE_CANDIDATES;
  let lastErr = "no candidates";
  for (const dt of tries) {
    try {
      const rows = await clerkSearchByTypes(dt, DEED_DAYS);
      distressWinner = dt;
      rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      return { rows: rows.slice(0, 60), docTypes: dt };
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
  }
  throw new Error(lastErr);
}

// ---- WARN notices (layoffs) ---------------------------------------------
export type WarnRow = { company: string; county: string; employees: string; date: string };

export async function fetchWarn(): Promise<{ items: WarnRow[] }> {
  let html = "", lastErr = "";
  for (const u of WARN_URLS) {
    try { html = await http(u, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36", Accept: "text/html" } }); break; }
    catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
  }
  if (!html) throw new Error(lastErr || "WARN page unreachable");
  const items: WarnRow[] = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(strip);
    if (cells.length < 3) continue;
    const joined = cells.join(" | ");
    if (!/hillsborough|tampa/i.test(joined)) continue;
    const date = joined.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)?.[0] ?? "";
    const employees = cells.find(c => /^\d{1,5}$/.test(c)) ?? "";
    items.push({ company: cells[0], county: "Hillsborough", employees, date });
    if (items.length >= 25) break;
  }
  if (items.length === 0) throw new Error("no Hillsborough rows parsed from WARN page");
  return { items };
}

// ---- leads: newsworthiness scoring --------------------------------------
// The tool's front page is not "rows from feeds", it is "reasons to make a
// call". Each lead carries a WHY line a reporter can react to instantly.
export type Lead = {
  id: string;
  score: number;          // higher = more newsworthy
  kind: string;           // deed | distress | warn | meeting | event
  why: string;            // the newsworthiness claim, in words
  what: string;           // the facts: who/what/where/when
  date?: string;
  deedId?: string;        // opens the deed drawer when set
};

const money = (n: number) => "$" + n.toLocaleString("en-US");

export function buildLeads(input: {
  deeds: DeedRow[]; distress: DeedRow[]; warn: WarnRow[];
  meetings: MeetingItem[];
}): Lead[] {
  const leads: Lead[] = [];

  for (const d of input.deeds) {
    let score = 0; const reasons: string[] = [];
    const entity = /\b(LLC|L\.L\.C|CORP|INC|TRUST|LP|HOLDINGS?)\b/i.test(d.to);
    const w = watchHit(`${d.from} ${d.to} ${d.legal}`);
    if (d.price >= 5 * BIG_SALE) { score += 50; reasons.push(`${money(d.price)} sale, one of the week's largest`); }
    else if (d.price >= BIG_SALE) { score += 25; reasons.push(`${money(d.price)} sale`); }
    if (entity && d.price >= BIG_SALE) { score += 15; reasons.push("bought through a corporate entity"); }
    if (d.price > 0 && d.price <= NOMINAL_MAX) { score += 8; reasons.push("nominal-price transfer, often an ownership shuffle"); }
    if (w) { score += 40; reasons.push(`watchlist: ${w}`); }
    if (score < 20) continue;
    leads.push({
      id: `deed-${d.instrument}`, score, kind: "deed",
      why: reasons.join(" · "),
      what: `${d.from} → ${d.to}${d.legal ? " · " + d.legal : ""}`,
      date: d.date, deedId: d.instrument,
    });
  }

  for (const d of input.distress) {
    let score = 12; const reasons: string[] = ["foreclosure/lis pendens filed"];
    const w = watchHit(`${d.from} ${d.to} ${d.legal}`);
    const entity = /\b(LLC|CORP|INC|HOLDINGS?)\b/i.test(d.to + " " + d.from);
    if (w) { score += 40; reasons.push(`watchlist: ${w}`); }
    if (entity) { score += 10; reasons.push("involves a corporate entity"); }
    if (score < 20) continue;
    leads.push({
      id: `lp-${d.instrument}`, score, kind: "distress",
      why: reasons.join(" · "),
      what: `${d.from} → ${d.to}${d.legal ? " · " + d.legal : ""}`,
      date: d.date, deedId: d.instrument,
    });
  }

  for (const wn of input.warn) {
    leads.push({
      id: `warn-${wn.company}-${wn.date}`, score: 70, kind: "warn",
      why: `mass layoff notice${wn.employees ? `: ${wn.employees} jobs` : ""}`,
      what: `${wn.company} · WARN filing`, date: wn.date,
    });
  }

  for (const m of input.meetings) {
    const w = watchHit(m.title);
    if (!w) continue;
    leads.push({
      id: `mtg-${m.url}`, score: 35, kind: "meeting",
      why: `watchlist topic on a government agenda: ${w}`,
      what: m.title, date: m.date,
    });
  }


  return leads.sort((a, b) => b.score - a.score).slice(0, 30);
}
