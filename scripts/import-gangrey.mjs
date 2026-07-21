#!/usr/bin/env node
/**
 * Gangrey Archive Importer
 *
 * RETIRED: this standalone script writes to Sanity, which the site migrated
 * off of in July 2026. It is kept only as a record of how the archive was
 * originally harvested. The live path is the admin route
 * (/api/admin/import-gangrey), which writes to the local SQLite store. Do not
 * run the --write mode; it targets the removed Sanity backend.
 *
 * Fetches gangrey.com pages from the Wayback Machine, parses each story, and
 * imports them into Sanity as section:"Gangrey Redux" posts.
 *
 * Usage:
 *   node scripts/import-gangrey.mjs --selftest          # offline parser smoke-test
 *   node scripts/import-gangrey.mjs --out gangrey.ndjson # fetch+parse → NDJSON file
 *   SANITY_API_WRITE_TOKEN=sk-... NEXT_PUBLIC_SANITY_PROJECT_ID=xxx \
 *     node scripts/import-gangrey.mjs --write           # real import into Sanity
 *
 * Optional flags (combinable):
 *   --limit N        process at most N stories (default: 10 for test, unlimited for --write)
 *   --from YYYYMMDD  earliest Wayback snapshot to consider (default: 20050101)
 *   --to   YYYYMMDD  latest  Wayback snapshot to consider (default: 20170101)
 *   --delay MS       ms to wait between Wayback requests (default: 800)
 */

import { parse } from "node-html-parser";
import fs from "fs";

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const SELFTEST  = args.includes("--selftest");
const DRY_RUN   = args.includes("--out")  || args.includes("--dry");
const WRITE     = args.includes("--write");
const outFile   = (() => { const i = args.indexOf("--out"); return i >= 0 ? args[i+1] : null; })();
const limitArg  = (() => { const i = args.indexOf("--limit"); return i >= 0 ? Number(args[i+1]) : null; })();
const fromArg   = (() => { const i = args.indexOf("--from"); return i >= 0 ? args[i+1] : "20050101"; })();
const toArg     = (() => { const i = args.indexOf("--to");   return i >= 0 ? args[i+1] : "20170101"; })();
const DELAY_MS  = (() => { const i = args.indexOf("--delay"); return i >= 0 ? Number(args[i+1]) : 800; })();
const LIMIT     = limitArg ?? (WRITE ? Infinity : 10);

if (!SELFTEST && !DRY_RUN && !WRITE && !outFile) {
  console.log(`Usage:
  node scripts/import-gangrey.mjs --selftest
  node scripts/import-gangrey.mjs --out gangrey.ndjson [--limit N]
  SANITY_API_WRITE_TOKEN=sk-... NEXT_PUBLIC_SANITY_PROJECT_ID=xxx \\
    node scripts/import-gangrey.mjs --write [--limit N]`);
  process.exit(0);
}

// ── Wayback helpers ───────────────────────────────────────────────────────────
const CDX = "https://web.archive.org/cdx/search/cdx";
const WB  = "https://web.archive.org/web";

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cdxQuery(paramPairs) {
  // paramPairs: array of [key, value] so we can repeat keys like filter=
  const qs = paramPairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const url = `${CDX}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDX ${res.status}: ${url}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const [header, ...data] = rows;
  return data.map(row => Object.fromEntries(header.map((k, i) => [k, row[i]])));
}

async function fetchWayback(timestamp, url) {
  const wb = `${WB}/${timestamp}id_/${url}`;
  const res = await fetch(wb, { headers: { "User-Agent": "gangrey-archive-importer/1.0 (+mailto:yacob@efemera.org)" } });
  if (!res.ok) throw new Error(`Wayback ${res.status}: ${wb}`);
  return res.text();
}

// ── Gangrey HTML parser ───────────────────────────────────────────────────────
// gangrey.com ran on WordPress. The important markup is fairly consistent
// across versions: .entry-title, .entry-content, .byline, .entry-date etc.

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 96);
}

// Split a Gangrey post's inner HTML into clean paragraph blocks. Gangrey used
// a single <p> with <br><br> between paragraphs (and sometimes multiple <p>).
function gangreyBodyBlocks(postEl) {
  const blocks = [];
  const ps = postEl.querySelectorAll("p");
  const sources = ps.length ? ps : [postEl];
  for (const p of sources) {
    const paras = p.innerHTML.split(/(?:<br\s*\/?>\s*){2,}/i); // double break = paragraph
    for (let part of paras) {
      part = part.replace(/<br\s*\/?>/gi, " ");                // single break = space
      const text = parse(`<x>${part}</x>`).innerText.replace(/\s+/g, " ").trim();
      if (text) blocks.push({ _type: "block", style: "normal", markDefs: [], children: [{ _type: "span", text, marks: [] }] });
    }
  }
  return blocks;
}

function parseGangreyPage(html, pageUrl, timestamp) {
  const root = parse(html);

  // Gangrey markup: <div class="post"> <a><h2 class="design">TITLE</h2></a>
  //                 <h4 class="byline">DEK</h4> <p>BODY…</p> </div>
  const idMatch = (() => { try { return new URL(pageUrl).pathname.match(/^\/(\d+)\/?$/)?.[1] ?? null; } catch { return null; } })();
  const posts = root.querySelectorAll("div.post");

  // A listing/home page has many posts and no numeric permalink — skip it so we
  // only import a story from its own permalink.
  if (posts.length > 1 && !idMatch) return null;

  let post = null;
  if (idMatch && posts.length) post = posts.find(p => p.querySelector(`a[href*="/${idMatch}"]`)) ?? null;
  if (!post) post = posts[0] ?? null;
  if (!post) return null; // no Gangrey post markup on this page

  const headlineEl = post.querySelector("h2.design") || post.querySelector(".design") || post.querySelector("h2") || post.querySelector("h1");
  const headline =
    headlineEl?.innerText?.trim() ||
    root.querySelector("title")?.innerText?.replace(/\s*[|\-–—]\s*gangrey.*$/i, "").trim() ||
    "";

  const subheadline = (post.querySelector("h4.byline") || post.querySelector(".byline"))?.innerText?.trim() || "";

  // Date: Gangrey post markup carries no reliable date, so use the Wayback
  // capture timestamp (good enough to order the archive chronologically).
  const date = parseDate(`${timestamp.slice(0,4)}-${timestamp.slice(4,6)}-${timestamp.slice(6,8)}`);

  // Strip the headline/byline/widgets, then serialize the remaining body.
  post.querySelectorAll("h2, h1, h4.byline, .byline, script, style, .sharedaddy, #comments, .comments, .meta, .postmeta, .navigation").forEach(n => n.remove());
  const body = gangreyBodyBlocks(post);
  if (!headline || !body.length) return null;

  // slug: numeric permalink id when present, else derived from headline
  let slug = idMatch || "";
  if (!slug) {
    try {
      const parts = new URL(pageUrl).pathname.replace(/\/$/, "").split("/").filter(Boolean);
      slug = parts[parts.length - 1] || slugify(headline);
    } catch { slug = slugify(headline); }
  }
  slug = `gangrey-${slug}`.slice(0, 96);

  return { headline, byline: "", date, subheadline, slug, body };
}

function parseDate(raw) {
  if (!raw) return new Date().toISOString();
  // Handle "January 5, 2010", "2010-01-05", "2010-01-05T12:00:00Z" etc.
  const d = new Date(raw);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}

// ── Sanity writer ─────────────────────────────────────────────────────────────
function toSanityDoc(story) {
  return {
    _id: `gangrey-import-${story.slug}`,
    _type: "post",
    section: "Gangrey Redux",
    status: "published",
    headline: story.headline,
    subheadline: story.subheadline || "",
    byline: story.byline || "",
    date: story.date,
    slug: { _type: "slug", current: story.slug },
    body: story.body,
    readingTime: Math.max(1, Math.round(story.body.map(b => b.children?.map(c => c.text||"").join("") || "").join(" ").split(/\s+/).length / 200)),
  };
}

async function sanityMutate(docs) {
  const token     = process.env.SANITY_API_WRITE_TOKEN;
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset   = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  if (!token || !projectId) throw new Error("Missing SANITY_API_WRITE_TOKEN or NEXT_PUBLIC_SANITY_PROJECT_ID");

  const mutations = docs.map(doc => ({ createOrReplace: doc }));
  const res = await fetch(
    `https://${projectId}.api.sanity.io/v2024-01-01/data/mutate/${dataset}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mutations }),
    }
  );
  if (!res.ok) throw new Error(`Sanity mutate failed: ${await res.text()}`);
  return res.json();
}

// ── Self-test ─────────────────────────────────────────────────────────────────
const SAMPLE_HTML = `
<html><head><title>The Long Drive | Gangrey</title></head><body>
<div id="sidebar"><div class="post"><a href="http://gangrey.com/999"><h2 class="design">Some Other Story</h2></a><h4 class="byline">dek</h4><p>nope</p></div></div>
<div class="post">
  <a href="http://gangrey.com/1745"><h2 class="design">The Long Drive</h2></a>
  <h4 class="byline">A road story</h4>
  <p>It was a Tuesday when we left. The highway unrolled ahead of us like a gray tongue.<br><br>
  My father didn't speak for the first hundred miles. Neither did I.<br><br>
  We stopped once for gas.</p>
</div>
</body></html>`;

function selfTest() {
  console.log("── Self-test (offline parser) ──");
  const result = parseGangreyPage(SAMPLE_HTML, "http://gangrey.com/1745", "20090812000000");
  if (!result) { console.error("FAIL: parseGangreyPage returned null"); process.exit(1); }
  console.assert(result.headline === "The Long Drive", `headline: "${result.headline}"`);
  console.assert(result.subheadline === "A road story", `subheadline: "${result.subheadline}"`);
  console.assert(result.date.startsWith("2009-08-12"), `date: "${result.date}"`);
  console.assert(result.slug === "gangrey-1745",       `slug: "${result.slug}"`);
  console.assert(result.body.length === 3,             `body blocks: ${result.body.length}`);
  console.log(`PASS — headline: "${result.headline}" | dek: "${result.subheadline}" | blocks: ${result.body.length} | slug: ${result.slug}`);
  const doc = toSanityDoc(result);
  console.assert(doc._type === "post",                          "_type");
  console.assert(doc.section === "Gangrey Redux",               "section");
  console.assert(doc.slug.current.startsWith("gangrey-"),       "slug.current");
  console.log(`PASS — Sanity doc _id: "${doc._id}" | section: "${doc.section}"`);
  console.log("All tests passed.");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (SELFTEST) { selfTest(); return; }

  // 1. Enumerate story URLs from Wayback CDX
  console.log(`Querying Wayback CDX for gangrey.com posts (${fromArg}–${toArg})…`);
  const rows = await cdxQuery([
    ["output", "json"],
    ["url", "gangrey.com"],
    ["matchType", "domain"],          // includes www. and any subdomain
    ["filter", "statuscode:200"],
    ["filter", "mimetype:text/html"],
    ["fl", "timestamp,original"],
    ["from", fromArg],
    ["to", toArg],
    ["collapse", "urlkey"],
    ["limit", String(Math.min(LIMIT * 40, 50000))], // over-fetch; parser is gatekeeper
  ]);
  console.log(`CDX returned ${rows.length} raw captures.`);
  if (rows.length) {
    console.log("Sample URLs:");
    for (const r of rows.slice(0, 8)) console.log("  " + r.original);
  }

  // Reject obvious non-stories (home, pagination, taxonomy, feeds, assets, query strings).
  // Everything else is handed to the parser, which returns null if there's no real story.
  const SKIP = /\/(page|category|tag|tagged|author|feed|wp-admin|wp-content|wp-login|comments|search)\b/i;
  const ASSET = /\.(css|js|png|jpe?g|gif|svg|ico|xml|json|txt|woff2?|ttf|pdf|mp3|mp4)$/i;
  const postRows = rows.filter(r => {
    try {
      const u = new URL(r.original);
      const p = u.pathname;
      if (p === "/" || p === "") return false;
      if (!decodeURIComponent(p).replace(/\//g, "").trim()) return false; // whitespace-only path (e.g. /%20)
      if (u.search) return false;
      if (SKIP.test(p)) return false;
      if (ASSET.test(p)) return false;
      return true;
    } catch { return false; }
  });

  console.log(`Found ${postRows.length} candidate story URLs (before limit of ${LIMIT}).`);
  const toProcess = postRows.slice(0, LIMIT);

  const docs = [];
  let ok = 0, skipped = 0, failed = 0;
  let diagDumped = false;
  const DIAG = args.includes("--diag");

  for (const [i, row] of toProcess.entries()) {
    const { timestamp, original } = row;
    process.stdout.write(`[${i+1}/${toProcess.length}] ${original} … `);
    try {
      await sleep(DELAY_MS);
      const html = await fetchWayback(timestamp, original);
      const story = parseGangreyPage(html, original, timestamp);
      if (!story) {
        console.log("skipped (no parseable story)"); skipped++;
        if (DIAG && !diagDumped) {
          diagDumped = true;
          const root = parse(html);
          const classes = new Set();
          root.querySelectorAll("*").forEach(el => {
            const c = el.getAttribute("class"); if (c) c.split(/\s+/).forEach(x => classes.add(x));
            const id = el.getAttribute("id"); if (id) classes.add("#" + id);
          });
          console.log("───────── DIAGNOSTIC DUMP (first skipped page) ─────────");
          console.log("TITLE:", root.querySelector("title")?.innerText?.trim());
          console.log("CLASSES/IDS PRESENT:", [...classes].sort().join(", "));
          console.log("H1:", root.querySelectorAll("h1").map(h => h.innerText?.trim()).join(" | "));
          console.log("H2:", root.querySelectorAll("h2").map(h => h.innerText?.trim()).slice(0,5).join(" | "));
          console.log("HTML SNIPPET (3500 chars from <body>):");
          const body = root.querySelector("body") ?? root;
          console.log(body.innerHTML.slice(0, 3500));
          console.log("──────────────────────────────────────────────────────");
        }
        continue;
      }
      docs.push(toSanityDoc(story));
      console.log(`OK — "${story.headline}" by ${story.byline || "(no byline)"}`);
      ok++;
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nParsed: ${ok} ok, ${skipped} skipped, ${failed} errors`);
  if (!docs.length) { console.log("Nothing to write."); return; }

  // 2a. Write NDJSON
  if (outFile) {
    fs.writeFileSync(outFile, docs.map(d => JSON.stringify(d)).join("\n") + "\n");
    console.log(`Wrote ${docs.length} docs → ${outFile}`);
    console.log(`Preview first entry:\n${JSON.stringify(docs[0], null, 2).slice(0, 800)}…`);
  }

  // 2b. Import into Sanity
  if (WRITE) {
    console.log(`\nImporting ${docs.length} docs into Sanity…`);
    const BATCH = 20;
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH);
      const result = await sanityMutate(batch);
      console.log(`Batch ${Math.floor(i/BATCH)+1}: ${JSON.stringify(result?.results?.length ?? result)} docs written`);
    }
    console.log("Import complete.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
