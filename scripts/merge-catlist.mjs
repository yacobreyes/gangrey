#!/usr/bin/env node
/**
 * Recover the posts lost in gangrey.com's WordPress migration.
 *
 * The pre-WordPress platform served category master lists
 * (categorylist_html?cat_id=N) containing EVERY post in full: an RDF metadata
 * block per post (title, numeric permalink id, creator, exact timestamp)
 * followed by the rendered post (h2.design headline, h4.byline dek, body).
 * The WP migration dropped ~727 of those posts — they appear on no WP month
 * page and have no ?p=N page. This script parses several catlist snapshots
 * (2007→2011, cat_ids 1–3), extracts every post, and merges the ones missing
 * from scripts/archive-rebuild.json into it.
 *
 *   node scripts/merge-catlist.mjs
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const { setGlobalDispatcher, EnvHttpProxyAgent } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const WB = "https://web.archive.org/web";
const CACHE = ".catlist-cache";
const DATASET = "scripts/archive-rebuild.json";
fs.mkdirSync(CACHE, { recursive: true });

// Snapshots to harvest: per cat_id, spread across the platform's life so
// later posts are covered too (each snapshot lists everything up to its date).
const SNAPSHOTS = [
  ["20071231191324", 1], ["20080510084253", 1], ["20101214235746", 1], ["20110416061816", 1],
  ["20071231191326", 2], ["20080510084255", 2], ["20101121232613", 2], ["20110121203955", 2],
  ["20071231191331", 3], ["20080510084300", 3], ["20101123184929", 3], ["20110325173544", 3],
];

const NAME_MAP = {
  "ben": "Ben Montgomery",
  "t lake": "Thomas Lake", "t.lake": "Thomas Lake", "tom lake": "Thomas Lake", "tlohnd": "Thomas Lake",
  "kruse": "Michael Kruse", "janine anderson": "Janine Anderson", "janine": "Janine Anderson",
  "mark johnson": "Mark Johnson", "eva holland": "Eva Holland",
};
const titleCase = s => s.replace(/\b([a-z])/g, m => m.toUpperCase());
function displayByline(raw) {
  const b = (raw || "").trim().toLowerCase();
  if (!b) return "Ben Montgomery";
  if (NAME_MAP[b]) return NAME_MAP[b];
  if (/\s/.test(b)) return titleCase(b);
  return "Ben Montgomery";
}
const straighten = s => s.replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"');
const decodeEntities = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, " ").replace(/&eacute;/g, "é").replace(/&hellip;/g, "…").replace(/&mdash;/g, "—");
const normHeadline = s => s.toLowerCase().replace(/&#\d+;|&\w+;/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cp = key => path.join(CACHE, crypto.createHash("sha1").update(key).digest("hex"));
async function fetchCached(url) {
  const f = cp(url);
  if (fs.existsSync(f)) { const r = fs.readFileSync(f, "utf8"); return r === "__FAIL__" ? null : r; }
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "gangrey-catlist/1.0 (+yacob@gangrey.org)" }, redirect: "follow" });
      if (res.status === 429 || res.status === 503) { await sleep(2500 * (a + 1)); continue; }
      if (res.status === 404) { fs.writeFileSync(f, "__FAIL__"); return null; }
      if (!res.ok) { await sleep(900 * (a + 1)); continue; }
      const t = await res.text();
      fs.writeFileSync(f, t);
      return t;
    } catch { await sleep(1200 * (a + 1)); }
  }
  fs.writeFileSync(f, "__FAIL__");
  return null;
}

// "2005/07/20 09:32:47.601 GMT-5" → ISO
function parseDate(d) {
  const m = d.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*GMT([+-]\d+)?/);
  if (!m) return null;
  const off = m[7] ? -(+m[7]) : 0; // GMT-5 → add 5h to get UTC
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + off, +m[5], +m[6]);
  return isNaN(t) ? null : new Date(t).toISOString();
}

function toBlocks(paras) {
  return paras.map((p, i) => {
    const k = crypto.createHash("sha1").update(i + ":" + p.slice(0, 40)).digest("hex").slice(0, 12);
    return { _type: "block", _key: k, style: "normal", markDefs: [], children: [{ _type: "span", _key: k + "s", text: p, marks: [] }] };
  });
}

function cleanPara(t) {
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  t = straighten(decodeEntities(t));
  return t.replace(/[ \t]+/g, " ").trim();
}

// Parse one catlist page into records keyed by numeric id.
function parseCatlist(html) {
  const out = new Map();
  // Each post: an RDF comment block, then the rendered entry.
  const segments = html.split(/<!--\s*<rdf:RDF/);
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const meta = seg.match(/dc:title="([\s\S]*?)"\s+dc:identifier="http:\/\/gangrey\.com\/(\d+)"[\s\S]*?dc:creator="([\s\S]*?)"\s+dc:date="([\s\S]*?)"/);
    if (!meta) continue;
    const [, rawTitle, id, creator, rawDate] = meta;
    const date = parseDate(rawDate);
    if (!date) continue;
    // Rendered part: after the closing --> of the RDF comment.
    const rendered = seg.slice(seg.indexOf("-->") + 3);
    const dekM = rendered.match(/<h4 class="byline">([\s\S]*?)<\/h4>/);
    // Body: paragraphs between the headline/dek and the next post's anchor
    // (the segment split already bounds us to this post).
    const bodyStart = dekM ? rendered.indexOf("</h4>") + 5 : rendered.indexOf("</a>") + 4;
    const bodyHtml = rendered.slice(bodyStart);
    const paras = [];
    for (const pm of bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
      const t = cleanPara(pm[1]);
      if (t) paras.push(t);
    }
    // Some short posts have bare text without <p>.
    if (!paras.length) {
      const t = cleanPara(bodyHtml.split(/<div|<table|<form/)[0]);
      if (t) paras.push(t);
    }
    if (!paras.length) continue;
    const rec = {
      id: +id,
      headline: straighten(decodeEntities(rawTitle)).replace(/\s+/g, " ").trim(),
      subheadline: dekM ? cleanPara(dekM[1]) : "",
      byline: displayByline(creator),
      date,
      paras,
    };
    const prev = out.get(rec.id);
    if (!prev || rec.paras.join(" ").length > prev.paras.join(" ").length) out.set(rec.id, rec);
  }
  return out;
}

(async () => {
  const all = new Map();
  for (const [ts, cat] of SNAPSHOTS) {
    const html = await fetchCached(`${WB}/${ts}id_/http://gangrey.com/categorylist_html?cat_id=${cat}`);
    if (!html) { console.log(`  snapshot ${ts} cat=${cat}: unavailable`); continue; }
    const recs = parseCatlist(html);
    for (const [id, r] of recs) {
      const prev = all.get(id);
      if (!prev || r.paras.join(" ").length > prev.paras.join(" ").length) all.set(id, r);
    }
    console.log(`  snapshot ${ts} cat=${cat}: ${recs.size} posts (running total ${all.size})`);
  }

  const dataset = JSON.parse(fs.readFileSync(DATASET, "utf8"));
  const haveSlug = new Set(dataset.map(r => r.slug));
  const haveTitleDay = new Set(dataset.map(r => `${normHeadline(r.headline)}|${r.date.slice(0, 10)}`));

  let added = 0;
  for (const r of all.values()) {
    if (haveSlug.has(`gangrey-${r.id}`)) continue;
    if (haveTitleDay.has(`${normHeadline(r.headline)}|${r.date.slice(0, 10)}`)) continue;
    const words = r.paras.join(" ").split(/\s+/).length;
    dataset.push({
      slug: `gangrey-${r.id}`,
      headline: r.headline,
      subheadline: r.subheadline,
      byline: r.byline,
      date: r.date,
      readingTime: Math.max(1, Math.round(words / 200)),
      body: toBlocks(r.paras),
    });
    added++;
  }
  dataset.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(DATASET, JSON.stringify(dataset));
  console.log(`\nMerged ${added} recovered posts → ${DATASET} now has ${dataset.length}.`);
  const jul05 = dataset.filter(r => r.date.startsWith("2005-07"));
  console.log(`July 2005 now: ${jul05.length} posts`);
  for (const r of jul05.slice(0, 10)) console.log("  ", r.date.slice(0, 10), "|", r.byline, "|", r.headline);
})();
