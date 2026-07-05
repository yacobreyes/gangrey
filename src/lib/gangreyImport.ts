// Shared logic for importing the Gangrey archive from the Wayback Machine.
// Used by the admin-triggered API route (runs on Vercel, which has the Sanity
// write token + internet). Mirrors scripts/import-gangrey.mjs.
import { parse } from "node-html-parser";
import type { PortableTextBlock } from "@portabletext/types";

const CDX = "https://web.archive.org/cdx/search/cdx";
const WB = "https://web.archive.org/web";

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Wayback rate-limits aggressively (429/503) and also drops connections
// outright ("fetch failed"). Retry both status codes AND thrown network
// errors with exponential backoff.
async function fetchRetry(url: string, opts: RequestInit = {}, tries = 5): Promise<Response> {
  let delay = 1500;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status !== 429 && res.status !== 503) return res;
    } catch (e) {
      lastErr = e; // network drop — retry below
    }
    if (i < tries - 1) { await sleep(delay); delay *= 2; }
  }
  if (lastErr) throw lastErr;
  return fetch(url, opts);
}

export type GangreyStory = {
  headline: string; subheadline: string; byline: string; date: string;
  slug: string; body: PortableTextBlock[];
};
export type Candidate = { timestamp: string; original: string; dateHint?: string };

export async function listCandidates(from = "20050101", to = "20170101"): Promise<Candidate[]> {
  // NOTE: no collapse=urlkey — we want EVERY capture so we can keep the LATEST
  // snapshot of each post. Gangrey ran 2005-2016; a post like /1745 may have an
  // early (2006) capture of unrelated/placeholder content and a real 2016
  // capture. We must fetch the latest, or we'd parse stale/wrong content.
  const pairs: [string, string][] = [
    ["output", "json"], ["url", "gangrey.com"], ["matchType", "domain"],
    ["filter", "statuscode:200"], ["filter", "mimetype:text/html"],
    ["fl", "timestamp,original"], ["from", from], ["to", to],
    ["limit", "200000"],
  ];
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const res = await fetchRetry(`${CDX}?${qs}`);
  if (!res.ok) throw new Error(`CDX ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const [header, ...data] = rows as string[][];
  const all = data.map(r => Object.fromEntries(header.map((k, i) => [k, r[i]]))) as unknown as Candidate[];

  const SKIP = /\/(page|category|tag|tagged|author|feed|wp-admin|wp-content|wp-login|comments|search)\b/i;
  const ASSET = /\.(css|js|png|jpe?g|gif|svg|ico|xml|json|txt|woff2?|ttf|pdf|mp3|mp4)$/i;
  const isStory = (r: Candidate) => {
    try {
      const u = new URL(r.original);
      const p = u.pathname;
      // 2016 WP relaunch used ?p=N query-string permalinks
      if (u.search && !/^\?p=\d+$/.test(u.search)) return false;
      // For ?p=N URLs the path is just "/"
      if (u.search && /^\?p=\d+$/.test(u.search)) {
        return true;
      }
      if (p === "/" || p === "") return false;
      if (!decodeURIComponent(p).replace(/\//g, "").trim()) return false;
      if (SKIP.test(p)) return false;
      if (ASSET.test(p)) return false;
      return true;
    } catch { return false; }
  };

  // Dedupe by normalized key, keeping the LATEST capture timestamp per post.
  const latest = new Map<string, Candidate>();
  for (const r of all) {
    if (!isStory(r)) continue;
    let key: string;
    try {
      const u = new URL(r.original);
      // ?p=N URLs: key by the p value; path-based: key by pathname
      key = /^\?p=\d+$/.test(u.search) ? u.search : u.pathname.replace(/\/$/, "");
    } catch { continue; }
    const prev = latest.get(key);
    if (!prev || r.timestamp > prev.timestamp) latest.set(key, r);
  }
  const cdxList = [...latest.values()];

  // The CDX only captured gangrey.com in 2006-2007. Stories published after
  // that weren't indexed by Wayback's bot. Supplement by scraping story links
  // from the Dec 2016 homepage snapshot (the last known capture of the site).
  const extra = await listCandidatesFromHomepage();
  const seen = new Set(cdxList.map(c => c.original));
  const merged = [...cdxList, ...extra.filter(c => isStory(c) && !seen.has(c.original))];

  // NOTE: We do NOT build the date map here — that's ~139 sequential Wayback
  // fetches (~45s+) and would blow the 60s function timeout. The date map is
  // built separately and cached; applyDateHints() stamps the candidates.
  return merged;
}

// Normalize a candidate/story URL to the canonical key used by the date map.
export function dateMapKey(original: string): string | null {
  try {
    const u = new URL(original);
    return /^\?p=\d+$/.test(u.search)
      ? `http://gangrey.com/${u.search}`
      : `http://gangrey.com${u.pathname.replace(/\/$/, "")}/`;
  } catch { return null; }
}

// Stamp each candidate with a dateHint from a prebuilt date map.
export function applyDateHints(candidates: Candidate[], dateMap: Map<string, string>): void {
  for (const c of candidates) {
    const key = dateMapKey(c.original);
    if (!key) continue;
    const hint = dateMap.get(key);
    if (hint) c.dateHint = hint;
  }
}

// ── RSS-feed date harvesting ────────────────────────────────────────────────
// Gangrey was WordPress, which publishes an RSS feed with machine-readable
// <pubDate> and the post id in <guid>. Wayback captured that feed hundreds of
// times across 2005–2016, so the UNION of all snapshots gives exact dates for
// far more posts than a single monthly-archive snapshot — and with no HTML
// guesswork. This is the most accurate date source we have.

// List every distinct Wayback capture of Gangrey's RSS feed(s). Catches BOTH
// pretty-permalink feeds (/feed/, /feed/rss/) AND query-string feeds
// (?feed=rss2, ?feed=atom) via a domain search with a server-side regex filter.
export async function listFeedCaptures(): Promise<Candidate[]> {
  const pairs: [string, string][] = [
    ["output", "json"], ["url", "gangrey.com"], ["matchType", "domain"],
    ["filter", "statuscode:200"],
    ["filter", "original:.*(/feed/?($|\\?)|[?&]feed=).*"],
    ["collapse", "digest"], // drop byte-identical snapshots
    ["fl", "timestamp,original"], ["from", "20050101"], ["to", "20170201"],
    ["limit", "100000"],
  ];
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const res = await fetchRetry(`${CDX}?${qs}`);
  if (!res.ok) throw new Error(`CDX feed ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const [header, ...data] = rows as string[][];
  const all = data.map(r => Object.fromEntries(header.map((k, i) => [k, r[i]]))) as unknown as Candidate[];
  // Keep only post feeds; drop comment feeds (?feed=comments-rss2, /comments/feed/).
  return all.filter(c => !/feed=comments|comments-rss|comments\/feed|comment-feed/i.test(c.original));
}

// Parse one RSS feed snapshot into [urlKey, isoDate] pairs. Each <item> yields
// both its <guid> (?p=N form) and <link> (permalink form) mapped to the same
// date, so applyDateHints matches whichever URL form a candidate uses.
// Unwrap CDATA sections: <foo><![CDATA[value]]></foo> → "value"
function unwrapCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
}

export function parseFeedDates(xml: string): [string, string][] {
  const out: [string, string][] = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const item of items) {
    const pub = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1];
    if (!pub) continue;
    const d = new Date(unwrapCdata(pub));
    if (isNaN(+d)) continue;
    const iso = d.toISOString();
    const urls: string[] = [];
    // CDATA-aware extraction for guid and link
    const guidRaw = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1];
    const linkRaw = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
    if (guidRaw) urls.push(unwrapCdata(guidRaw));
    if (linkRaw) urls.push(unwrapCdata(linkRaw));
    for (const u of urls) {
      // Normalize the wayback-rewritten host if present
      const clean = u.replace(/^https?:\/\/web\.archive\.org\/web\/\d+\w*\//, "");
      const key = dateMapKey(clean);
      if (key) out.push([key, iso]);
    }
  }
  return out;
}

// Expose for the feedprobe diagnostic endpoint.
export function parseFeedDatesDiag(xml: string): { items: number; pairs: [string, string][]; rawItems: string[] } {
  const rawItems = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  return { items: rawItems.length, pairs: parseFeedDates(xml), rawItems: rawItems.slice(0, 3) };
}

// Fetch a slice of feed snapshots and merge their dates into a map. Bounded by
// `limit` so each call stays under the function timeout; the caller loops by
// offset and persists the cumulative map.
export async function harvestFeedDates(
  captures: Candidate[],
  offset: number,
  limit: number
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const slice = captures.slice(offset, offset + limit);
  for (const c of slice) {
    try {
      const xml = await fetchWayback(c.timestamp, c.original);
      for (const [key, iso] of parseFeedDates(xml)) {
        // Prefer the EARLIEST date seen — that's the true publication date
        // (later feed snapshots can show edited/republished timestamps).
        const prev = map.get(key);
        if (!prev || iso < prev) map.set(key, iso);
      }
    } catch { /* snapshot fetch failed — skip */ }
    await sleep(150);
  }
  return map;
}

// Build a URL → ISO date map by scraping every monthly archive page
// (http://gangrey.com/?m=YYYYMM) from June 2005 through Dec 2016.
// The monthly archive lists each story with its exact publication date in
// a <time datetime="..."> element (WP theme) or in the post meta text
// (old theme). This is more reliable than parsing individual story pages.
export async function buildDateMap(
  fromYear = 2005,
  toYear = 2016,
  onProgress?: (msg: string) => void
): Promise<Map<string, string>> {
  // Wayback snapshot close to site shutdown — reliable for all months
  const TS = "20170106142958";
  const dateMap = new Map<string, string>();

  const months: string[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const start = y === 2005 ? 6 : 1;
    const end = 12;
    for (let m = start; m <= end; m++) {
      months.push(`${y}${String(m).padStart(2, "0")}`);
    }
  }

  for (const ym of months) {
    try {
      onProgress?.(`Fetching ?m=${ym}`);
      const html = await fetchWayback(TS, `http://gangrey.com/?m=${ym}`);
      const root = parse(html);
      const year = parseInt(ym.slice(0, 4), 10);
      const month = parseInt(ym.slice(4), 10);

      // WordPress theme (2016): <article> with <time class="entry-date" datetime="ISO">
      for (const article of root.querySelectorAll("article")) {
        const timeEl = article.querySelector("time.entry-date[datetime]") || article.querySelector("time[datetime]");
        const dt = timeEl?.getAttribute("datetime");
        const links = article.querySelectorAll("a[href]");
        for (const a of links) {
          const href = a.getAttribute("href") ?? "";
          try {
            const u = new URL(href, "http://gangrey.com/");
            if (u.hostname !== "gangrey.com") continue;
            const key = /^\?p=\d+$/.test(u.search)
              ? `http://gangrey.com/${u.search}`
              : /^\/\d+\/?$/.test(u.pathname)
              ? `http://gangrey.com${u.pathname.replace(/\/$/, "")}/`
              : null;
            if (!key) continue;
            const date = dt ? parseDate(dt) : new Date(Date.UTC(year, month - 1, 1)).toISOString();
            if (!dateMap.has(key)) dateMap.set(key, date);
          } catch { /* skip */ }
        }
      }

      // Old custom theme (2005-2007): <div class="post"> with <div class="posted">
      for (const post of root.querySelectorAll("div.post")) {
        // Extract date from div.posted: "Posted by ben on MM/DD/YY at ..."
        const postedEl = post.querySelector("div.posted");
        let date: string | null = null;
        if (postedEl) {
          const t = cleanText(postedEl.innerText ?? "");
          const dm = t.match(/\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
          if (dm) {
            const [, m2, d, yRaw] = dm;
            const y2 = yRaw.length === 2 ? 2000 + parseInt(yRaw, 10) : parseInt(yRaw, 10);
            date = new Date(Date.UTC(y2, parseInt(m2, 10) - 1, parseInt(d, 10))).toISOString();
          }
        }
        if (!date) date = new Date(Date.UTC(year, month - 1, 1)).toISOString();

        // Find the permalink — typically an <a> wrapping the <h2> or a "permalink" link
        for (const a of post.querySelectorAll("a[href]")) {
          const href = a.getAttribute("href") ?? "";
          try {
            const u = new URL(href, "http://gangrey.com/");
            if (u.hostname !== "gangrey.com") continue;
            if (!/^\/\d+\/?$/.test(u.pathname)) continue;
            const key = `http://gangrey.com${u.pathname.replace(/\/$/, "")}/`;
            if (!dateMap.has(key)) dateMap.set(key, date);
          } catch { /* skip */ }
        }
      }

      await sleep(300);
    } catch { /* month may have no snapshot — skip */ }
  }

  return dateMap;
}

// Fetch the Dec 2016 Wayback homepage and extract story links not in CDX.
async function listCandidatesFromHomepage(): Promise<Candidate[]> {
  const HOMEPAGE_TS = "20161217014844";
  const HOMEPAGE_URL = "http://gangrey.com/";
  try {
    const html = await fetchWayback(HOMEPAGE_TS, HOMEPAGE_URL);
    const root = parse(html);
    const results: Candidate[] = [];
    // Follow pagination — Gangrey showed ~10 posts per page
    const links = root.querySelectorAll("a[href]");
    for (const a of links) {
      const href = a.getAttribute("href") ?? "";
      try {
        const u = new URL(href, "http://gangrey.com/");
        if (u.hostname !== "gangrey.com") continue;
        const p = u.pathname;
        if (/^\/\d+\/?$/.test(p)) {
          results.push({ timestamp: HOMEPAGE_TS, original: `http://gangrey.com${p}` });
        } else if (/^\?p=\d+$/.test(u.search) && (p === "/" || p === "")) {
          results.push({ timestamp: HOMEPAGE_TS, original: `http://gangrey.com/${u.search}` });
        }
      } catch { /* skip */ }
    }
    // Also try a few paginated archive pages to catch stories not on homepage
    for (const page of ["page/2", "page/3", "page/4", "page/5"]) {
      try {
        await sleep(400);
        const pageHtml = await fetchWayback(HOMEPAGE_TS, `http://gangrey.com/${page}/`);
        const pageRoot = parse(pageHtml);
        for (const a of pageRoot.querySelectorAll("a[href]")) {
          const href = a.getAttribute("href") ?? "";
          try {
            const u = new URL(href, "http://gangrey.com/");
            if (u.hostname !== "gangrey.com") continue;
            if (/^\/\d+\/?$/.test(u.pathname)) {
              results.push({ timestamp: HOMEPAGE_TS, original: `http://gangrey.com${u.pathname}` });
            } else if (/^\?p=\d+$/.test(u.search) && (u.pathname === "/" || u.pathname === "")) {
              results.push({ timestamp: HOMEPAGE_TS, original: `http://gangrey.com/${u.search}` });
            }
          } catch { /* skip */ }
        }
      } catch { /* page may not exist */ }
    }
    return results;
  } catch {
    return [];
  }
}

// Diagnostic: probe several homepage snapshots and report what links exist.
export async function diagnoseHomepage(ts = "20161217014844") {
  const out: Record<string, unknown> = { ts };
  try {
    const html = await fetchWayback(ts, "http://gangrey.com/");
    out.htmlLength = html.length;
    const root = parse(html);
    const hrefs = root.querySelectorAll("a[href]").map(a => a.getAttribute("href") ?? "");
    out.totalLinks = hrefs.length;
    // Sample distinct hrefs that point back at gangrey
    const gangreyHrefs = hrefs.filter(h => /gangrey\.com/i.test(h) || h.startsWith("/"));
    out.sampleGangreyHrefs = [...new Set(gangreyHrefs)].slice(0, 40);
    // First 600 chars of the page text + title for orientation
    out.title = root.querySelector("title")?.innerText ?? "";
    out.postDivs = root.querySelectorAll("div.post, article").length;
  } catch (e) {
    out.error = String(e);
  }
  return out;
}

// Diagnostic: fetch an arbitrary gangrey URL and dump its article/post markup.
export async function probeUrl(original: string, ts = "20161217014844") {
  const out: Record<string, unknown> = { original, ts };
  try {
    const html = await fetchWayback(ts, original);
    out.htmlLength = html.length;
    const root = parse(html);
    out.title = root.querySelector("title")?.innerText ?? "";
    const el = root.querySelector("article") || root.querySelector("div.post") ||
      root.querySelector(".entry-content")?.parentNode || root.querySelector("main");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out.containerTag = (el as any)?.rawTagName ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out.containerClass = (el as any)?.getAttribute?.("class") ?? null;
    out.markup = el?.outerHTML?.slice(0, 2500) ?? "(no article/post container found)";
    out.parsed = parseGangreyPage(html, original, ts);
  } catch (e) {
    out.error = String(e);
  }
  return out;
}

export async function fetchWayback(timestamp: string, url: string): Promise<string> {
  const res = await fetchRetry(`${WB}/${timestamp}id_/${url}`, {
    headers: { "User-Agent": "gangrey-archive-importer/1.0 (+mailto:yacob@gangrey.org)" },
  });
  if (!res.ok) throw new Error(`Wayback ${res.status}`);
  return res.text();
}

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 96);
}

// Decode HTML entities (numeric + common named) that node-html-parser's
// innerText leaves raw — Gangrey's markup is full of &#8220; &#8217; etc.
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘").replace(/&rsquo;/g, "’")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const cleanText = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

// Gangrey's custom theme uses:  <div class="posted">Posted by <b>ben</b> on 10/14/05 at ...</div>
// NOT standard WordPress meta format.
const DATE_RE = /([A-Za-z]+ \d{1,2},?\s+\d{4})/;
const AUTHOR_RE = /\bby\s+([A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*){0,2})/i;
const META_LINE_RE = /(?:posted\s+on\s+)?[A-Za-z]+ \d{1,2},?\s+\d{4}\s+by\s+[A-Za-z]/i;

function titleCase(s: string) {
  return s.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMetaFields(post: any, root: any, timestamp: string): { byline: string; date: string } {
  const fallbackDate = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;

  // Gangrey format: <div class="posted">Posted by <b>AUTHOR</b> on MM/DD/YY at ...</div>
  const postedEl = (post ?? root).querySelector("div.posted") || root.querySelector("div.posted");
  if (postedEl) {
    const authorEl = postedEl.querySelector("b") || postedEl.querySelector("strong");
    const byline = authorEl?.innerText ? titleCase(cleanText(authorEl.innerText)) : "";

    // Date: "on 10/14/05" — two-digit year in 2000s
    const t = cleanText(postedEl.innerText ?? "");
    const dm = t.match(/\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (dm) {
      const [, m, d, yRaw] = dm;
      const y = yRaw.length === 2 ? 2000 + parseInt(yRaw, 10) : parseInt(yRaw, 10);
      const date = new Date(Date.UTC(y, parseInt(m, 10) - 1, parseInt(d, 10))).toISOString();
      return { byline, date };
    }
    return { byline, date: parseDate(fallbackDate) };
  }

  // Fallback for any story that doesn't have div.posted
  const timeEl = root.querySelector("time[datetime]");
  const date = timeEl?.getAttribute?.("datetime")
    ? parseDate(timeEl.getAttribute("datetime"))
    : parseDate(fallbackDate);
  const authorEl = root.querySelector('a[rel="author"]') || root.querySelector(".author a");
  const byline = authorEl?.innerText ? titleCase(cleanText(authorEl.innerText)) : "";
  return { byline, date };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gangreyBodyBlocks(postEl: any): PortableTextBlock[] {
  const blocks: PortableTextBlock[] = [];
  const ps = postEl.querySelectorAll("p");
  const sources = ps.length ? ps : [postEl];
  for (const p of sources) {
    const paras = p.innerHTML.split(/(?:<br\s*\/?>\s*){2,}/i);
    for (let part of paras) {
      part = part.replace(/<br\s*\/?>/gi, " ");
      const text = cleanText(parse(`<x>${part}</x>`).innerText);
      if (text) blocks.push({ _type: "block", style: "normal", markDefs: [], children: [{ _type: "span", text, marks: [] }] } as unknown as PortableTextBlock);
    }
  }
  return blocks;
}

function parseDate(raw: string) {
  const d = new Date(raw);
  return isNaN(+d) ? new Date().toISOString() : d.toISOString();
}

export function parseGangreyPage(html: string, pageUrl: string, timestamp: string, dateHint?: string): GangreyStory | null {
  const root = parse(html);
  // dateHint comes from the monthly archive cross-reference — prefer it over
  // anything we parse from the story page itself, which can be unreliable.
  const fallbackDate = dateHint ?? `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;

  // Check if this is a 2016 WordPress post (?p=N URL or <article> container)
  const pMatch = (() => { try { return new URL(pageUrl).search.match(/^\?p=(\d+)$/)?.[1] ?? null; } catch { return null; } })();
  const article = root.querySelector("article");
  if (pMatch || article) {
    const art = article ?? root.querySelector("main") ?? root;
    const headline = cleanText(
      art.querySelector("h1.entry-title")?.innerText ??
      art.querySelector("h1")?.innerText ??
      root.querySelector("title")?.innerText?.replace(/\s*[|\-–—]\s*gangrey.*$/i, "") ?? ""
    );
    const timeEl = art.querySelector("time.entry-date[datetime]") || art.querySelector("time[datetime]");
    const rawDate = timeEl?.getAttribute("datetime") ? parseDate(timeEl.getAttribute("datetime")!) : null;
    // Prefer dateHint (from monthly archive cross-ref) over page-parsed date
    const date = dateHint ? parseDate(dateHint) : rawDate ?? parseDate(fallbackDate);
    const authorEl = art.querySelector("a[rel=author]") || art.querySelector(".author.vcard a") || art.querySelector(".author a");
    const byline = authorEl?.innerText ? titleCase(cleanText(authorEl.innerText)) : "";

    const content = art.querySelector(".entry-content") || art.querySelector(".post-content") || art;
    content.querySelectorAll("script, style, .sharedaddy, #comments, .navigation, .entry-header, header").forEach((n: ReturnType<typeof root.querySelector>) => n?.remove());
    const body = gangreyBodyBlocks(content);
    if (!headline || !body.length) return null;

    const slug = `gangrey-p${pMatch || slugify(headline)}`.slice(0, 96);
    return { headline, byline, date, subheadline: "", slug, body };
  }

  // 2005–2007 custom theme: div.post containers
  const idMatch = (() => { try { return new URL(pageUrl).pathname.match(/^\/(\d+)\/?$/)?.[1] ?? null; } catch { return null; } })();
  const posts = root.querySelectorAll("div.post");
  if (posts.length > 1 && !idMatch) return null;

  let post = null as ReturnType<typeof root.querySelector> | null;
  if (idMatch && posts.length) post = posts.find(p => p.querySelector(`a[href*="/${idMatch}"]`)) ?? null;
  if (!post) post = posts[0] ?? null;
  if (!post) return null;

  const headlineEl = post.querySelector("h2.design") || post.querySelector(".design") || post.querySelector("h2") || post.querySelector("h1");
  const headline = (headlineEl?.innerText ? cleanText(headlineEl.innerText) : "") ||
    cleanText((root.querySelector("title")?.innerText ?? "").replace(/\s*[|\-–—]\s*gangrey.*$/i, ""));

  const { byline, date } = extractMetaFields(post, root, timestamp);
  const subheadline = "";

  post.querySelectorAll("h2, h1, h4.byline, .byline, .entry-meta, .post-meta, script, style, .sharedaddy, #comments, .comments, .meta, .postmeta, .navigation").forEach(n => n.remove());
  const body = gangreyBodyBlocks(post);
  if (!headline || !body.length) return null;

  let slug = idMatch || "";
  if (!slug) {
    try {
      const parts = new URL(pageUrl).pathname.replace(/\/$/, "").split("/").filter(Boolean);
      slug = parts[parts.length - 1] || slugify(headline);
    } catch { slug = slugify(headline); }
  }
  slug = `gangrey-${slug}`.slice(0, 96);

  return { headline, byline, date, subheadline, slug, body };
}

export function toSanityDoc(s: GangreyStory) {
  const words = s.body.map(b => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = (b as any).children as { text?: string }[] | undefined;
    return ch?.map(c => c.text ?? "").join(" ") ?? "";
  }).join(" ").split(/\s+/).filter(Boolean).length;
  return {
    _id: `gangrey-import-${s.slug}`,
    _type: "post",
    section: "Archive",
    status: "published",
    headline: s.headline,
    subheadline: s.subheadline,
    byline: s.byline,
    date: s.date,
    slug: { _type: "slug", current: s.slug },
    body: s.body,
    readingTime: Math.max(1, Math.round(words / 200)),
  };
}

export async function writeDocs(docs: unknown[]): Promise<number> {
  // Self-hosted: the same createOrReplace mutations apply to the local store,
  // so the Wayback archive import works without Sanity.
  if (process.env.STORAGE_BACKEND === "sqlite") {
    const { sqliteMutate } = await import("./storage/sqlite");
    sqliteMutate(docs.map(doc => ({ createOrReplace: doc })));
    return docs.length;
  }
  const token = process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_WRITE_TOKEN;
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  if (!token || !projectId) throw new Error("Missing Sanity write token or project id in environment");
  const mutations = docs.map(doc => ({ createOrReplace: doc }));
  const res = await fetch(`https://${projectId}.api.sanity.io/v2024-01-01/data/mutate/${dataset}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mutations }),
  });
  if (!res.ok) throw new Error(`Sanity mutate failed: ${await res.text()}`);
  const j = await res.json();
  return j?.results?.length ?? docs.length;
}
