#!/usr/bin/env node
/**
 * DeLorean: a wayback-downloader-style full static mirror of the old
 * gangrey.com, pinned to the snapshot nearest 2016-12-17 (20161217014844),
 * rebuilt to browse at gangrey.org/delorean.
 *
 * - CDX-lists every captured URL, picks each URL's snapshot closest to the
 *   pin, downloads the raw capture (id_ = no Wayback toolbar), and maps it to
 *   a local path (querystring pages become directories: /?p=5 → p/5/index.html).
 * - Rewrites every internal gangrey.com link/asset to its /delorean/ path;
 *   external links are left alone. Wayback-injected script/comments stripped.
 *
 * Output: <DATA_DIR or ./data>/delorean/  (~4,000 files)
 * Fetches cache under .delorean-cache/ so re-runs resume.
 *
 *   node scripts/build-delorean.mjs
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const { setGlobalDispatcher, EnvHttpProxyAgent } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const PIN = "20161217014844";
const CDX = "https://web.archive.org/cdx/search/cdx";
const WB = "https://web.archive.org/web";
const CACHE = ".delorean-cache";
const OUT = path.join(process.env.DATA_DIR || "./data", "delorean");
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cp = key => path.join(CACHE, crypto.createHash("sha1").update(key).digest("hex"));

async function fetchCached(url, binary = false) {
  const f = cp(url);
  if (fs.existsSync(f)) {
    const b = fs.readFileSync(f);
    return b.length === 8 && b.toString() === "__FAIL__" ? null : b;
  }
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "gangrey-delorean/1.0 (+yacob@gangrey.org)" }, redirect: "follow" });
      if (res.status === 429 || res.status === 503) { await sleep(2500 * (a + 1)); continue; }
      if (res.status === 404) { fs.writeFileSync(f, "__FAIL__"); return null; }
      if (!res.ok) { await sleep(900 * (a + 1)); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(f, buf);
      return buf;
    } catch { await sleep(1200 * (a + 1)); }
  }
  fs.writeFileSync(f, "__FAIL__");
  return null;
}

// ── URL → local path mapping ────────────────────────────────────────────────
// Normalizes host variants (www, :80) and turns querystring routes into
// directories so the mirror is plain static files.
function normalize(u) {
  return u.replace(/^https?:\/\/(www\.)?gangrey\.com(:80)?/i, "").replace(/^\/+/, "/") || "/";
}
function localPath(u) {
  let p = normalize(u);
  if (p === "/" || p === "") return "index.html";
  const [pathname, qs] = p.split("?");
  if (qs !== undefined) {
    const params = new URLSearchParams(qs);
    const pid = params.get("p"), m = params.get("m"), paged = params.get("paged"), cat = params.get("cat"), author = params.get("author");
    if (pid) return `p/${pid}/index.html`;
    if (m && paged) return `m/${m}/page/${paged}/index.html`;
    if (m) return `m/${m}/index.html`;
    if (paged) return `page/${paged}/index.html`;
    if (cat) return `cat/${cat}${params.get("paged") ? `/page/${params.get("paged")}` : ""}/index.html`;
    if (author) return `author/${author}/index.html`;
    return null; // feeds, xmlrpc, search, trackbacks — skip
  }
  const clean = pathname.replace(/^\//, "").replace(/\/$/, "");
  if (!clean) return "index.html";
  if (/\.html?$/i.test(clean)) return clean; // literal .html paths stay files
  if (/^\d+$/.test(clean)) return `${clean}/index.html`; // old permalink /1234
  if (/\.(css|js|jpe?g|png|gif|ico|svg|woff2?|ttf)$/i.test(clean)) return clean;
  if (clean.startsWith("wp-content/") || clean.startsWith("wp-includes/")) return clean;
  return `${clean.replace(/[^a-zA-Z0-9/_.-]/g, "_")}/index.html`;
}
// The href a page should use to point at a mirrored URL.
function localHref(u) {
  const lp = localPath(u);
  if (!lp) return null;
  return "/delorean/" + lp.replace(/\/index\.html$/, "/").replace(/^index\.html$/, "");
}

// ── HTML rewriting ──────────────────────────────────────────────────────────
function rewriteHtml(html) {
  let s = html;
  // Strip Wayback-injected blocks if any leaked through id_ (belt & braces).
  s = s.replace(/<script[^>]*archive\.org[^>]*>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<!--\s*BEGIN WAYBACK[\s\S]*?END WAYBACK[^>]*-->/gi, "");
  // Rewrite every internal absolute URL (href/src/srcset/css url()).
  s = s.replace(/https?:\/\/(?:www\.)?gangrey\.com(?::80)?(\/[^"'\s)<>]*)?/gi, (full, tail) => {
    const href = localHref(tail || "/");
    return href ?? full;
  });
  // Point stragglers of the old feed/search endpoints at the homepage rather
  // than a 404 hole.
  s = s.replace(/\/delorean\/(xmlrpc\.php|wp-login\.php)[^"']*/g, "/delorean/");
  // Tag the page so readers know where they are (and search engines stay out).
  s = s.replace(/<head([^>]*)>/i, `<head$1>\n<meta name="robots" content="noindex, nofollow">\n<base target="_self">`);
  return s;
}

async function pool(items, n, fn) {
  let i = 0;
  async function worker() { while (i < items.length) await fn(items[i++]); }
  await Promise.all(Array.from({ length: n }, worker));
}

(async () => {
  // Every capture of every URL; pick per-URL the timestamp nearest the pin.
  console.log("Listing captures…");
  const raw = await fetchCached(`${CDX}?url=${encodeURIComponent("gangrey.com*")}&output=text&fl=original,timestamp&filter=statuscode:200&limit=200000`);
  if (!raw) throw new Error("CDX listing failed");
  const nearest = new Map(); // localPath → {orig, ts, dist}
  for (const line of raw.toString().split("\n")) {
    const [orig, ts] = line.trim().split(" ");
    if (!orig || !ts) continue;
    const lp = localPath(orig);
    if (!lp) continue;
    const dist = Math.abs(+ts - +PIN);
    const prev = nearest.get(lp);
    if (!prev || dist < prev.dist) nearest.set(lp, { orig, ts, dist });
  }
  const entries = [...nearest.entries()];
  console.log(`Mirroring ${entries.length} files → ${OUT}`);

  let done = 0, ok = 0;
  await pool(entries, 5, async ([lp, { orig, ts }]) => {
    const dest = path.join(OUT, lp);
    if (!fs.existsSync(dest)) {
      const buf = await fetchCached(`${WB}/${ts}id_/${orig}`, true);
      if (buf) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (/\.html$/.test(lp)) fs.writeFileSync(dest, rewriteHtml(buf.toString("utf8")));
        else fs.writeFileSync(dest, buf);
        ok++;
      }
    } else ok++;
    if (++done % 250 === 0) console.log(`  …${done}/${entries.length} (ok ${ok})`);
  });
  console.log(`Done: ${ok}/${entries.length} files mirrored.`);
})();
