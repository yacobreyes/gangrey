#!/usr/bin/env node
/**
 * Build a clean, authoritative Gangrey archive dataset for a full re-import.
 *
 * Every post is keyed by its real WordPress post-id (from the harvest, whose
 * dates+bylines come from RSS <pubDate>/<dc:creator>). For each id we fetch its
 * own ?p=N page from Wayback and take the headline + body from THAT SAME page —
 * so headline, date, byline and body can never be mismatched (the failure mode
 * of the original import).
 *
 * Output: scripts/archive-rebuild.json  [{ slug, headline, byline, date, body, readingTime }]
 * Fetches cached under .gangrey-rebuild-cache/ so re-runs resume.
 *
 *   node scripts/build-archive-rebuild.mjs
 */
import { parse } from "node-html-parser";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Node's fetch does NOT read HTTPS_PROXY on its own; in proxied environments
// every request silently fails. Route through the env proxy when one is set.
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const { setGlobalDispatcher, EnvHttpProxyAgent } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const WB = "https://web.archive.org/web";
const SNAP = "20161024173100"; // late-life snapshot; Wayback serves nearest capture
const CACHE = ".gangrey-rebuild-cache";
const OUT = "scripts/archive-rebuild.json";
fs.mkdirSync(CACHE, { recursive: true });

const fixes = JSON.parse(fs.readFileSync("src/lib/gangreyFixes.json", "utf8"));
const bySlug = fixes.bySlug || {};
const byHeadline = fixes.byHeadline || {};
const normHeadline = s => s.toLowerCase().replace(/&#\d+;|&\w+;/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
// House style: straight quotes.
const straighten = s => s.replace(/[\u2018\u2019\u201A]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"');
const decodeEntities = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");

// WP username → display byline (poster). Same policy as apply-gangrey-fixes.
const NAME_MAP = {
  "ben": "Ben Montgomery",
  "t lake": "Thomas Lake", "t.lake": "Thomas Lake", "tom lake": "Thomas Lake", "tlohnd": "Thomas Lake",
  "kruse": "Michael Kruse", "janine anderson": "Janine Anderson", "janine": "Janine Anderson",
  "mark johnson": "Mark Johnson", "eva holland": "Eva Holland",
};
const titleCase = s => s.replace(/\b([a-z])/g, m => m.toUpperCase());
function displayByline(raw) {
  const b = (raw || "").trim();
  if (!b) return "Ben Montgomery"; // blog default poster
  if (NAME_MAP[b]) return NAME_MAP[b];
  if (/\s/.test(b)) return titleCase(b);
  return "Ben Montgomery"; // lone unknown username → default to the poster
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function cp(key) { return path.join(CACHE, crypto.createHash("sha1").update(key).digest("hex")); }
async function fetchCached(url) {
  const f = cp(url);
  if (fs.existsSync(f)) { const r = fs.readFileSync(f, "utf8"); return r === "__FAIL__" ? null : r; }
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "gangrey-rebuild/1.0 (+yacob@gangrey.org)" }, redirect: "follow" });
      if (res.status === 429 || res.status === 503) { await sleep(2000 * (a + 1)); continue; }
      if (res.status === 404) { fs.writeFileSync(f, "__FAIL__"); return null; }
      if (!res.ok) { await sleep(800 * (a + 1)); continue; }
      const t = await res.text();
      fs.writeFileSync(f, t);
      return t;
    } catch { await sleep(1000 * (a + 1)); }
  }
  fs.writeFileSync(f, "__FAIL__");
  return null;
}

// Extract headline + body paragraphs from a ?p=N post page (handles both WP
// themes the blog ran over the years).
function extractPost(html) {
  const root = parse(html);
  const titleEl =
    root.querySelector("h2.design") ||
    root.querySelector("h1.entry-title") ||
    root.querySelector(".entry-title") ||
    root.querySelector("h2.entry-title") ||
    root.querySelector(".post h2") ||
    root.querySelector("h2");
  let headline = (titleEl?.innerText || "").replace(/\s+/g, " ").trim();
  // Trim WP's "  | Gangrey" suffix if we fell through to <title>.
  headline = headline.replace(/\s*[|–—]\s*Gangrey.*$/i, "").trim();

  const contentEl =
    root.querySelector(".entry-content") ||
    root.querySelector("div.entry") ||
    root.querySelector(".post .entry") ||
    root.querySelector(".postcontent");
  if (!contentEl) return { headline, paras: [] };

  // Drop the dek/byline widgets, comments, sharing, nav.
  contentEl.querySelectorAll("script, style, .sharedaddy, #comments, .comments, .meta, .postmeta, .navigation, .wp-caption-text").forEach(n => n.remove());

  const paras = [];
  for (const p of contentEl.querySelectorAll("p")) {
    let t = p.innerHTML.replace(/<br\s*\/?>/gi, "\n");
    t = t.replace(/<[^>]+>/g, "");
    t = t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
         .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
         .replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘")
         .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
         .replace(/&#8212;|&mdash;/g, "—").replace(/&#8230;|&hellip;/g, "…").replace(/&nbsp;/g, " ");
    t = t.replace(/[ \t]+/g, " ").trim();
    if (t) paras.push(t);
  }
  // If the theme didn't use <p>, fall back to the raw text split on blank lines.
  if (!paras.length) {
    const raw = contentEl.innerText.replace(/\r/g, "").split(/\n\s*\n/).map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    paras.push(...raw);
  }
  return { headline, paras };
}

function toBlocks(paras) {
  return paras.map((p, i) => {
    const k = crypto.createHash("sha1").update(i + ":" + p.slice(0, 40)).digest("hex").slice(0, 12);
    return { _type: "block", _key: k, style: "normal", markDefs: [], children: [{ _type: "span", _key: k + "s", text: p, marks: [] }] };
  });
}

async function pool(items, n, fn) {
  let i = 0; const out = [];
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

(async () => {
  const ids = [...new Set(Object.keys(bySlug).map(k => (k.match(/^gangrey-p?(\d+)$/) || [])[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
  console.log(`Building ${ids.length} posts…`);

  let done = 0, ok = 0, skipped = 0;
  const records = await pool(ids, 5, async (id) => {
    const meta = bySlug[`gangrey-p${id}`] || bySlug[`gangrey-${id}`];
    if (!meta || !meta.d) { skipped++; return null; }
    const html = await fetchCached(`${WB}/${SNAP}id_/http://gangrey.com/?p=${id}`);
    if (++done % 100 === 0) console.log(`  …${done}/${ids.length} (ok ${ok})`);
    if (!html) { skipped++; return null; }
    let { headline, paras } = extractPost(html);
    if (!headline || paras.length === 0) { skipped++; return null; }
    ok++;
    headline = straighten(decodeEntities(headline));
    paras = paras.map(t => straighten(t));
    // Byline: the per-post ?p=N feeds are COMMENT feeds — dc:creator there is
    // the commenter, not the author (how "Starting Somewhere" briefly became
    // Mark Davis). The main-feed byHeadline table carries the true author, so
    // prefer it; bySlug is the fallback. Same preference for the timestamp.
    const hb = byHeadline[normHeadline(headline)];
    const rawByline = (hb && hb.b) || meta.b;
    // Date stays per-id (bySlug): headline-keyed dates would give every post
    // sharing a title the same day. Per-id timestamps agree with the main feed
    // where both exist, so they're trustworthy.
    const date = meta.d;
    const words = paras.join(" ").split(/\s+/).length;
    return {
      slug: `gangrey-${id}`,
      headline,
      byline: displayByline(rawByline),
      date,
      readingTime: Math.max(1, Math.round(words / 200)),
      body: toBlocks(paras),
    };
  });

  // Dedupe: Wayback occasionally serves the same story under two post-ids
  // (same headline, same day). Keep the fuller capture.
  const byKey = new Map();
  for (const r of records.filter(Boolean)) {
    const key = r.headline.toLowerCase() + "|" + r.date.slice(0, 10);
    const prev = byKey.get(key);
    if (!prev || r.body.length > prev.body.length) byKey.set(key, r);
  }
  const clean = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(OUT, JSON.stringify(clean));
  console.log(`\nWrote ${OUT}: ${clean.length} posts (skipped ${skipped}).`);
  console.log("Earliest 8:");
  for (const r of clean.slice(0, 8)) console.log("  ", r.date.slice(0, 10), "|", r.byline, "|", r.headline, `(${r.body.length}p)`);
})();
