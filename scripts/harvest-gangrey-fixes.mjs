#!/usr/bin/env node
/**
 * Harvest correct publication dates + bylines for the imported Gangrey archive.
 *
 * Sources, in order of authority:
 *   1. RSS feed snapshots (Wayback) — exact <pubDate> and <dc:creator> per item,
 *      keyed by ?p=N guid and permalink, plus the item <title>.
 *   2. Monthly archive pages (?m=YYYYMM at a late snapshot) — dates for both WP
 *      themes; "Posted by <b>user</b> on MM/DD/YY" bylines on the old theme.
 *   3. (Optional gap-fill) earliest per-story snapshot — div.posted meta.
 *
 * Output: scripts/gangrey-fixes.json
 *   { bySlug: { "gangrey-123": {d,b}, "gangrey-p4661": {d,b} },
 *     byHeadline: { "<normalized headline>": {d,b} },
 *     creators: { ben: 1234, ... } }
 *
 * All Wayback responses are cached under .gangrey-harvest-cache/ so re-runs
 * are cheap and interrupted runs resume where they left off.
 *
 * Usage: node scripts/harvest-gangrey-fixes.mjs [--feeds] [--monthly] [--gapfill] [--report]
 *        (no flags = feeds + monthly + report)
 */

import { parse } from "node-html-parser";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const CDX = "https://web.archive.org/cdx/search/cdx";
const WB = "https://web.archive.org/web";
const CACHE_DIR = ".gangrey-harvest-cache";
const OUT_FILE = "scripts/gangrey-fixes.json";

const args = process.argv.slice(2);
const DO_FEEDS = args.includes("--feeds") || args.length === 0 || args.includes("--report");
const DO_MONTHLY = args.includes("--monthly") || args.length === 0 || args.includes("--report");
const DO_GAPFILL = args.includes("--gapfill");

fs.mkdirSync(CACHE_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Cached, retrying fetch ───────────────────────────────────────────────────
function cachePath(key) {
  return path.join(CACHE_DIR, crypto.createHash("sha1").update(key).digest("hex"));
}

async function fetchCached(url, { asJson = false } = {}) {
  const cp = cachePath(url);
  if (fs.existsSync(cp)) {
    const raw = fs.readFileSync(cp, "utf8");
    if (raw === "__FAIL__") return null;
    return asJson ? JSON.parse(raw) : raw;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "gangrey-archive-fixer/1.0 (+mailto:yacob@gangrey.org)" }, redirect: "follow" });
      if (res.status === 429 || res.status === 503) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      fs.writeFileSync(cp, text);
      return asJson ? JSON.parse(text) : text;
    } catch (err) {
      if (attempt === 4) {
        fs.writeFileSync(cp, "__FAIL__");
        return null;
      }
      await sleep(1200 * (attempt + 1));
    }
  }
  return null;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0, done = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
      done++;
      if (done % 25 === 0) process.stdout.write(`  …${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Normalization (mirrors src/lib/gangreyDedup.ts) ─────────────────────────
function normalizeHeadline(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/&#?\w+;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapCdata(s) {
  return (s ?? "").replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
}

function decodeEntities(s) {
  return (s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—");
}

// slug keys used by the Sanity import:
//   http://gangrey.com/1234/  → gangrey-1234
//   http://gangrey.com/?p=987 → gangrey-p987
function slugKeysForUrl(raw) {
  const clean = (raw ?? "").replace(/^https?:\/\/web\.archive\.org\/web\/\d+\w*\//, "");
  try {
    const u = new URL(clean, "http://gangrey.com/");
    if (!/gangrey\.com$/i.test(u.hostname)) return [];
    const pMatch = u.search.match(/[?&]p=(\d+)\b/);
    const pathMatch = u.pathname.match(/^\/(\d+)\/?$/);
    const keys = [];
    if (pMatch) { keys.push(`gangrey-p${pMatch[1]}`); keys.push(`gangrey-${pMatch[1]}`); }
    if (pathMatch) { keys.push(`gangrey-${pathMatch[1]}`); keys.push(`gangrey-p${pathMatch[1]}`); }
    return keys;
  } catch { return []; }
}

// ── The accumulating fix map ─────────────────────────────────────────────────
// slug → { d: ISO date, b: byline username, src: priority }
// Priority: feed (3) > monthly-posted (2) > monthly-date-only (1)
const bySlug = new Map();
const byHeadline = new Map();
const creators = new Map();

function record(map, key, d, b, src, pri) {
  if (!key) return;
  const prev = map.get(key);
  if (prev) {
    // Keep earliest date at equal-or-lower priority; higher priority wins outright.
    if (pri > prev.pri) map.set(key, { d: d ?? prev.d, b: b || prev.b, pri });
    else {
      if (d && (!prev.d || d < prev.d)) prev.d = d;
      if (b && !prev.b) prev.b = b;
    }
  } else {
    map.set(key, { d, b: b || "", pri });
  }
}

// ── Phase A: RSS feeds ───────────────────────────────────────────────────────
async function harvestFeeds() {
  console.log("Phase A: RSS feed snapshots");
  const pairs = [
    ["output", "json"], ["url", "gangrey.com"], ["matchType", "domain"],
    ["filter", "statuscode:200"],
    ["filter", "original:.*(/feed/?($|\\?)|[?&]feed=).*"],
    ["collapse", "digest"],
    ["fl", "timestamp,original"], ["from", "20050101"], ["to", "20170201"],
    ["limit", "100000"],
  ];
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const rows = await fetchCached(`${CDX}?${qs}`, { asJson: true });
  if (!rows || rows.length < 2) { console.log("  no feed captures"); return; }
  const caps = rows.slice(1)
    .map(([timestamp, original]) => ({ timestamp, original }))
    .filter(c => !/feed=comments|comments-rss|comments\/feed|comment-feed/i.test(c.original));
  console.log(`  ${caps.length} feed captures`);

  await mapPool(caps, 4, async c => {
    const xml = await fetchCached(`${WB}/${c.timestamp}id_/${c.original}`);
    if (!xml) return;
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
    for (const item of items) {
      const pubRaw = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1];
      const d = pubRaw ? new Date(unwrapCdata(pubRaw)) : null;
      const iso = d && !isNaN(+d) ? d.toISOString() : null;
      const creator = unwrapCdata(item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i)?.[1] ?? "").trim().toLowerCase();
      const title = decodeEntities(unwrapCdata(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ""));
      if (!iso) continue;
      if (creator) creators.set(creator, (creators.get(creator) ?? 0) + 1);
      const urls = [
        unwrapCdata(item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ?? ""),
        unwrapCdata(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? ""),
      ].filter(Boolean);
      for (const u of urls) for (const key of slugKeysForUrl(u)) record(bySlug, key, iso, creator, "feed", 3);
      const hn = normalizeHeadline(title);
      if (hn) record(byHeadline, hn, iso, creator, "feed", 3);
    }
  });
  console.log(`  bySlug: ${bySlug.size}, byHeadline: ${byHeadline.size}`);
}

// ── Phase B: monthly archive pages ───────────────────────────────────────────
async function harvestMonthly() {
  console.log("Phase B: monthly archive pages");
  const TS = "20170106142958";
  const months = [];
  for (let y = 2005; y <= 2016; y++) {
    for (let m = (y === 2005 ? 6 : 1); m <= 12; m++) months.push(`${y}${String(m).padStart(2, "0")}`);
  }
  await mapPool(months, 4, async ym => {
    const html = await fetchCached(`${WB}/${TS}id_/http://gangrey.com/?m=${ym}`);
    if (!html) return;
    const root = parse(html);
    const year = +ym.slice(0, 4), month = +ym.slice(4);

    // 2016 WP theme
    for (const article of root.querySelectorAll("article")) {
      const dt = (article.querySelector("time.entry-date[datetime]") || article.querySelector("time[datetime]"))?.getAttribute("datetime");
      const authorEl = article.querySelector("a[rel=author]") || article.querySelector(".author.vcard a") || article.querySelector(".author a");
      const byline = (authorEl?.innerText ?? "").trim().toLowerCase();
      const titleEl = article.querySelector("h1.entry-title, h2.entry-title, .entry-title");
      const hn = normalizeHeadline(decodeEntities(titleEl?.innerText ?? ""));
      const date = dt ? new Date(dt) : null;
      const iso = date && !isNaN(+date) ? date.toISOString() : new Date(Date.UTC(year, month - 1, 1)).toISOString();
      if (byline) creators.set(byline, (creators.get(byline) ?? 0) + 1);
      for (const a of article.querySelectorAll("a[href]")) {
        for (const key of slugKeysForUrl(a.getAttribute("href"))) record(bySlug, key, iso, byline, "monthly", dt ? 2 : 1);
      }
      if (hn) record(byHeadline, hn, iso, byline, "monthly", dt ? 2 : 1);
    }

    // 2005–2007 custom theme
    for (const post of root.querySelectorAll("div.post")) {
      const postedEl = post.querySelector("div.posted");
      let iso = null, byline = "";
      if (postedEl) {
        const t = (postedEl.innerText ?? "").replace(/\s+/g, " ").trim();
        const bm = t.match(/Posted by\s+(.+?)\s+on\s/i);
        byline = (postedEl.querySelector("b, strong")?.innerText ?? bm?.[1] ?? "").trim().toLowerCase();
        const dm = t.match(/\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (dm) {
          const y2 = dm[3].length === 2 ? 2000 + +dm[3] : +dm[3];
          iso = new Date(Date.UTC(y2, +dm[1] - 1, +dm[2])).toISOString();
        }
      }
      if (!iso) iso = new Date(Date.UTC(year, month - 1, 1)).toISOString();
      if (byline) creators.set(byline, (creators.get(byline) ?? 0) + 1);
      const titleEl = post.querySelector("h2.design") || post.querySelector("h2");
      const hn = normalizeHeadline(decodeEntities(titleEl?.innerText ?? ""));
      for (const a of post.querySelectorAll("a[href]")) {
        for (const key of slugKeysForUrl(a.getAttribute("href"))) record(bySlug, key, iso, byline, "monthly-old", postedEl ? 2 : 1);
      }
      if (hn) record(byHeadline, hn, iso, byline, "monthly-old", postedEl ? 2 : 1);
    }
  });
  console.log(`  bySlug: ${bySlug.size}, byHeadline: ${byHeadline.size}`);
}

// ── Phase C: story-universe coverage report ──────────────────────────────────
async function coverageReport() {
  console.log("Phase C: coverage vs CDX story universe");
  const mk = q => `${CDX}?${q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;
  const base = [["output", "json"], ["url", "gangrey.com"], ["matchType", "domain"], ["filter", "statuscode:200"], ["collapse", "urlkey"], ["fl", "timestamp,original"], ["from", "20050101"], ["to", "20170201"], ["limit", "200000"]];
  const rows1 = await fetchCached(mk([...base, ["filter", "original:https?://(www\\.)?gangrey\\.com/\\d+/?$"]]), { asJson: true }) ?? [];
  const rows2 = await fetchCached(mk([...base, ["filter", "original:https?://(www\\.)?gangrey\\.com/\\?p=\\d+$"]]), { asJson: true }) ?? [];
  const universe = new Set();
  for (const rows of [rows1, rows2]) {
    for (const row of rows.slice(1)) for (const key of slugKeysForUrl(row[1]).slice(0, 1)) universe.add(key);
  }
  let covered = 0;
  const missing = [];
  for (const key of universe) {
    if (bySlug.has(key) || bySlug.has(key.startsWith("gangrey-p") ? key.replace("gangrey-p", "gangrey-") : key.replace("gangrey-", "gangrey-p"))) covered++;
    else missing.push(key);
  }
  console.log(`  universe: ${universe.size} story URLs, covered: ${covered}, missing: ${missing.length}`);
  fs.writeFileSync(path.join(CACHE_DIR, "missing.json"), JSON.stringify(missing, null, 2));
  return missing;
}

// ── Phase D (optional): per-story gap-fill ───────────────────────────────────
async function gapFill(missing) {
  console.log(`Phase D: gap-fill ${missing.length} stories from earliest snapshots`);
  await mapPool(missing, 4, async key => {
    const id = key.replace(/^gangrey-p?/, "");
    const original = key.startsWith("gangrey-p") ? `http://gangrey.com/?p=${id}` : `http://gangrey.com/${id}/`;
    const rows = await fetchCached(`${CDX}?output=json&url=${encodeURIComponent(original)}&filter=statuscode:200&fl=timestamp&limit=1`, { asJson: true });
    const ts = rows?.[1]?.[0];
    if (!ts) return;
    const html = await fetchCached(`${WB}/${ts}id_/${original}`);
    if (!html) return;
    const root = parse(html);
    const postedEl = root.querySelector("div.posted");
    let iso = null, byline = "";
    if (postedEl) {
      const t = (postedEl.innerText ?? "").replace(/\s+/g, " ").trim();
      byline = (postedEl.querySelector("b, strong")?.innerText ?? "").trim().toLowerCase();
      const dm = t.match(/\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (dm) {
        const y2 = dm[3].length === 2 ? 2000 + +dm[3] : +dm[3];
        iso = new Date(Date.UTC(y2, +dm[1] - 1, +dm[2])).toISOString();
      }
    }
    if (!iso) {
      const dt = root.querySelector("time[datetime]")?.getAttribute("datetime");
      if (dt && !isNaN(+new Date(dt))) iso = new Date(dt).toISOString();
    }
    if (!byline) {
      const authorEl = root.querySelector("a[rel=author]") || root.querySelector(".author a");
      byline = (authorEl?.innerText ?? "").trim().toLowerCase();
    }
    // Even with no in-page meta, first-capture date beats the import's arbitrary
    // snapshot date as a publication estimate.
    if (!iso) iso = new Date(Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8))).toISOString();
    if (byline) creators.set(byline, (creators.get(byline) ?? 0) + 1);
    record(bySlug, key, iso, byline, "gapfill", 1);
  });
  console.log(`  bySlug now: ${bySlug.size}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // Load previous output so phases are additive across runs.
  if (fs.existsSync(OUT_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
      for (const [k, v] of Object.entries(prev.bySlug ?? {})) bySlug.set(k, { ...v, pri: v.pri ?? 1 });
      for (const [k, v] of Object.entries(prev.byHeadline ?? {})) byHeadline.set(k, { ...v, pri: v.pri ?? 1 });
      for (const [k, v] of Object.entries(prev.creators ?? {})) creators.set(k, v);
      console.log(`Loaded previous output: ${bySlug.size} slugs`);
    } catch { /* start fresh */ }
  }

  if (DO_FEEDS) await harvestFeeds();
  if (DO_MONTHLY) await harvestMonthly();
  const missing = await coverageReport();
  if (DO_GAPFILL && missing.length) { await gapFill(missing); await coverageReport(); }

  const out = {
    generatedAt: new Date().toISOString(),
    bySlug: Object.fromEntries([...bySlug.entries()].map(([k, { d, b, pri }]) => [k, { d, b, pri }])),
    byHeadline: Object.fromEntries([...byHeadline.entries()].map(([k, { d, b, pri }]) => [k, { d, b, pri }])),
    creators: Object.fromEntries([...creators.entries()].sort((a, b) => b[1] - a[1])),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log(`\nWrote ${OUT_FILE}: ${bySlug.size} slugs, ${byHeadline.size} headlines`);
  console.log("Creators:", Object.entries(out.creators).slice(0, 15));
})();
