// tampatrib: fetch + cache + radar helpers, ported from the original PHP
// sub-site. Server-side only.
import { createHmac, timingSafeEqual } from "crypto";
import { XMLParser } from "fast-xml-parser";
import { WATCHLIST, BIG_SALE, NOMINAL_MAX, DEED_DAYS, CACHE_TTL } from "@/app/trib/config";

const UA = "Mozilla/5.0 (Macintosh) tampatrib-subsite/1.0";

// ---- auth --------------------------------------------------------------
// Cookie value = HMAC(password) with the server secret, so changing either
// the password or NEXTAUTH_SECRET invalidates every session at once.
export const TRIB_COOKIE = "trib_ok";

export function tribPassword(): string | null {
  return process.env.TRIB_PASSWORD || null;
}

export function tribToken(): string | null {
  const pw = tribPassword();
  if (!pw) return null;
  return createHmac("sha256", process.env.NEXTAUTH_SECRET ?? "trib").update(`trib:${pw}`).digest("base64url");
}

export function tribTokenValid(value: string | undefined | null): boolean {
  const want = tribToken();
  if (!want || !value) return false;
  const a = Buffer.from(value), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

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

export type FeedItem = { title: string; url: string; date?: string };

export async function fetchRss(url: string): Promise<{ items: FeedItem[] }> {
  const xml = await http(url);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
  // RSS: rss.channel.item[]; Atom: feed.entry[]
  const raw = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const nodes = Array.isArray(raw) ? raw : [raw];
  const items: FeedItem[] = [];
  for (const i of nodes) {
    if (!i) continue;
    const linkNode = i.link;
    const link = typeof linkNode === "string" ? linkNode
      : Array.isArray(linkNode) ? (linkNode.find((l: Record<string, string>) => l?.["@_rel"] !== "self")?.["@_href"] ?? linkNode[0]?.["@_href"] ?? "")
      : linkNode?.["@_href"] ?? linkNode?.["#text"] ?? "";
    const title = typeof i.title === "string" ? i.title : i.title?.["#text"] ?? "";
    items.push({ title: String(title).trim(), url: String(link), date: String(i.pubDate ?? i.updated ?? "") });
    if (items.length >= 8) break;
  }
  if (items.length === 0) throw new Error("unparseable feed");
  return { items };
}

export type RedditItem = { title: string; url: string; score: number; comments: number };

export async function fetchReddit(sub: string): Promise<{ items: RedditItem[] }> {
  const j = JSON.parse(await http(`https://www.reddit.com/r/${sub}/hot.json?limit=10`));
  const items: RedditItem[] = [];
  for (const c of j?.data?.children ?? []) {
    const d = c.data;
    if (d?.stickied) continue;
    items.push({ title: d.title, url: `https://reddit.com${d.permalink}`, score: d.score ?? 0, comments: d.num_comments ?? 0 });
  }
  return { items };
}

export type NwsAlert = { event: string; headline: string; severity: string; url: string };

export async function fetchNws(): Promise<{ items: NwsAlert[] }> {
  const j = JSON.parse(await http("https://api.weather.gov/alerts/active?area=FL", {
    headers: { Accept: "application/geo+json" },
  }));
  const items: NwsAlert[] = [];
  for (const f of j?.features ?? []) {
    const p = f.properties ?? {};
    if (!/Hillsborough|Tampa|Pinellas/i.test(p.areaDesc ?? "")) continue;
    items.push({ event: p.event ?? "", headline: p.headline ?? "", severity: String(p.severity ?? "").toLowerCase(), url: p["@id"] ?? "" });
  }
  return { items };
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
