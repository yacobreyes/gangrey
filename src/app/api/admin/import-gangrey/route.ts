import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { requireAdminOrCronSecret } from "@/lib/adminAuth";
import { listCandidates, fetchWayback, parseGangreyPage, toArchiveDoc, writeDocs, sleep, diagnoseHomepage, probeUrl, buildDateMap, applyDateHints, listFeedCaptures, harvestFeedDates, parseFeedDatesDiag, type Candidate } from "@/lib/gangreyImport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const TMP_CACHE = "/tmp/gangrey-cdx-cache.json";
const DATEMAP_CACHE = "/tmp/gangrey-datemap.json";
const FEED_CAPTURES_CACHE = "/tmp/gangrey-feed-captures.json";
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// Load the prebuilt URL→date map from /tmp (built incrementally via ?buildmap).
async function loadDateMap(): Promise<Map<string, string>> {
  try {
    const raw = await fs.readFile(DATEMAP_CACHE, "utf8");
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch { return new Map(); }
}

async function saveDateMap(map: Map<string, string>): Promise<void> {
  await fs.writeFile(DATEMAP_CACHE, JSON.stringify(Object.fromEntries(map)), "utf8").catch(() => {});
  _mem = null;
  await fs.unlink(TMP_CACHE).catch(() => {}); // force candidates to re-stamp
}

// Cache CDX index to /tmp so it survives lambda cold starts.
let _mem: { at: number; list: Candidate[] } | null = null;
async function getCandidates(fresh = false): Promise<Candidate[]> {
  if (!fresh) {
    if (_mem && Date.now() - _mem.at < CACHE_TTL) return _mem.list;
    try {
      const raw = await fs.readFile(TMP_CACHE, "utf8");
      const { at, list } = JSON.parse(raw) as { at: number; list: Candidate[] };
      if (Date.now() - at < CACHE_TTL) { _mem = { at, list }; return list; }
    } catch { /* cache miss */ }
  }
  const list = await listCandidates();
  // Stamp dateHints from the prebuilt date map cache, if present.
  const dateMap = await loadDateMap();
  if (dateMap.size) applyDateHints(list, dateMap);
  const at = Date.now();
  _mem = { at, list };
  await fs.writeFile(TMP_CACHE, JSON.stringify({ at, list }), "utf8").catch(() => {});
  return list;
}

// Imports a batch of Gangrey stories from the Wayback Machine into the store.
// Batched via ?offset & ?limit so each call stays under the function timeout;
// the admin page loops through batches. Gated to the admin Google session.
export async function GET(req: NextRequest) {
  try { await requireAdminOrCronSecret(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const url = new URL(req.url);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10) || 10));
  const dry = url.searchParams.get("dry") === "1";
  const diag = url.searchParams.get("diag") === "1";
  const fresh = url.searchParams.get("fresh") === "1";

  // Homepage probe — runs before candidate list so a stale cache won't block it.
  if (url.searchParams.get("diaghome") === "1") {
    const ts = url.searchParams.get("ts") ?? undefined;
    return NextResponse.json(await diagnoseHomepage(ts));
  }
  // Probe an arbitrary URL: ?probe=http://gangrey.com/?p=5852
  const probe = url.searchParams.get("probe");
  if (probe) {
    const ts = url.searchParams.get("ts") ?? undefined;
    return NextResponse.json(await probeUrl(probe, ts));
  }

  // Build the URL→date map in year chunks (each ~12 Wayback fetches, well under
  // the 60s limit) and merge into the /tmp cache. The admin page loops the
  // chunks: ?buildmap=1&fromYear=2005&toYear=2006 ... until toYear reaches 2016.
  if (url.searchParams.get("buildmap") === "1") {
    const fromYear = Math.max(2005, parseInt(url.searchParams.get("fromYear") ?? "2005", 10) || 2005);
    const toYear = Math.min(2016, parseInt(url.searchParams.get("toYear") ?? String(fromYear + 1), 10) || fromYear + 1);
    try {
      const chunk = await buildDateMap(fromYear, toYear);
      const existing = await loadDateMap();
      for (const [k, v] of chunk) existing.set(k, v);
      await fs.writeFile(DATEMAP_CACHE, JSON.stringify(Object.fromEntries(existing)), "utf8").catch(() => {});
      // Invalidate the candidate cache so the next import picks up new hints.
      _mem = null;
      await fs.unlink(TMP_CACHE).catch(() => {});
      return NextResponse.json({
        fromYear, toYear, added: chunk.size, totalMapped: existing.size,
        done: toYear >= 2016,
        nextFromYear: toYear >= 2016 ? null : toYear + 1,
        nextToYear: toYear >= 2016 ? null : Math.min(2016, toYear + 2),
      });
    } catch (e) {
      return NextResponse.json({ error: `buildDateMap failed: ${String(e)}`, fromYear, toYear }, { status: 502 });
    }
  }

  // Diagnostic: how many feed snapshots does CDX have, and a sample.
  if (url.searchParams.get("feeddiag") === "1") {
    try {
      const captures = await listFeedCaptures();
      await fs.writeFile(FEED_CAPTURES_CACHE, JSON.stringify(captures), "utf8").catch(() => {});
      return NextResponse.json({
        totalCaptures: captures.length,
        sample: captures.slice(0, 20).map(c => `${c.timestamp} ${c.original}`),
      });
    } catch (e) {
      return NextResponse.json({ error: `feed list failed: ${String(e)}` }, { status: 502 });
    }
  }

  // Probe a single feed snapshot: return raw XML head + parseFeedDatesDiag output.
  // ?feedprobe=1&offset=N — uses the cached feed-capture list (or fetches it).
  if (url.searchParams.get("feedprobe") === "1") {
    const probeOffset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
    try {
      let captures: Candidate[];
      try {
        const raw = await fs.readFile(FEED_CAPTURES_CACHE, "utf8");
        captures = JSON.parse(raw) as Candidate[];
        if (!Array.isArray(captures) || !captures.length) throw new Error("empty");
      } catch {
        captures = await listFeedCaptures();
        await fs.writeFile(FEED_CAPTURES_CACHE, JSON.stringify(captures), "utf8").catch(() => {});
      }
      captures = captures.filter(c => !/feed=comments|comments-rss|comments\/feed|comment-feed/i.test(c.original));
      const c = captures[probeOffset];
      if (!c) return NextResponse.json({ error: "No capture at that offset", total: captures.length });
      const xml = await fetchWayback(c.timestamp, c.original);
      const diag = parseFeedDatesDiag(xml);
      return NextResponse.json({
        offset: probeOffset, total: captures.length,
        capture: { timestamp: c.timestamp, original: c.original },
        xmlHead: xml.slice(0, 2000),
        itemCount: diag.items,
        pairsExtracted: diag.pairs.length,
        pairs: diag.pairs.slice(0, 20),
        rawItems: diag.rawItems,
      });
    } catch (e) {
      return NextResponse.json({ error: `feedprobe failed: ${String(e)}` }, { status: 502 });
    }
  }

  // Harvest exact dates from Wayback's RSS-feed snapshots. The feed-capture
  // list is fetched once (cached to /tmp), then processed in slices of `limit`
  // snapshots per call. The admin page loops by offset until done. Earliest
  // pubDate per post wins (true publication date).
  if (url.searchParams.get("buildfeeds") === "1") {
    const feedOffset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
    const feedLimit = Math.min(60, Math.max(1, parseInt(url.searchParams.get("limit") ?? "30", 10) || 30));
    try {
      // Load or build the feed-capture list
      let captures: Candidate[];
      try {
        const raw = await fs.readFile(FEED_CAPTURES_CACHE, "utf8");
        captures = JSON.parse(raw) as Candidate[];
        if (!Array.isArray(captures) || !captures.length) throw new Error("empty");
      } catch {
        captures = await listFeedCaptures();
        await fs.writeFile(FEED_CAPTURES_CACHE, JSON.stringify(captures), "utf8").catch(() => {});
      }
      // Defensively drop comment feeds even if a stale cache included them.
      captures = captures.filter(c => !/feed=comments|comments-rss|comments\/feed|comment-feed/i.test(c.original));

      const chunk = await harvestFeedDates(captures, feedOffset, feedLimit);
      const existing = await loadDateMap();
      for (const [k, v] of chunk) {
        const prev = existing.get(k);
        if (!prev || v < prev) existing.set(k, v); // earliest wins
      }
      await saveDateMap(existing);

      const nextOffset = feedOffset + feedLimit;
      return NextResponse.json({
        offset: feedOffset, limit: feedLimit,
        totalCaptures: captures.length,
        processedSnapshots: Math.min(nextOffset, captures.length),
        addedThisChunk: chunk.size,
        totalMapped: existing.size,
        done: nextOffset >= captures.length,
        nextOffset: nextOffset >= captures.length ? null : nextOffset,
      });
    } catch (e) {
      return NextResponse.json({ error: `feed harvest failed: ${String(e)}`, offset: feedOffset }, { status: 502 });
    }
  }

  let candidates;
  try {
    candidates = await getCandidates(fresh);
  } catch (e) {
    return NextResponse.json({ error: `Wayback CDX failed: ${String(e)}` }, { status: 502 });
  }

  // Stats mode: report the candidate list make-up (post-id range, last 20 urls)
  if (url.searchParams.get("stats") === "1") {
    const ids = candidates
      .map(c => { const m = c.original.match(/\/(\d+)\/?$/); return m ? parseInt(m[1], 10) : null; })
      .filter((n): n is number => n !== null);
    return NextResponse.json({
      total: candidates.length,
      minId: ids.length ? Math.min(...ids) : null,
      maxId: ids.length ? Math.max(...ids) : null,
      last20: candidates.slice(-20).map(c => c.original),
    });
  }

  // Diagnostic mode: return raw HTML + parsed fields for one story.
  // ?diagid=N targets the candidate whose URL ends with /N; else by offset.
  if (diag) {
    const diagid = url.searchParams.get("diagid");
    const c = diagid
      ? candidates.find(x => new RegExp(`/${diagid}/?$`).test(x.original))
      : candidates[offset];
    if (!c) return NextResponse.json({ error: "No candidate found" });
    try {
      const html = await fetchWayback(c.timestamp, c.original);
      const { parse } = await import("node-html-parser");
      const root = parse(html);
      const post = root.querySelector("div.post");
      const postHtml = post?.outerHTML?.slice(0, 2000) ?? "(no div.post found)";
      const story = parseGangreyPage(html, c.original, c.timestamp, c.dateHint);
      return NextResponse.json({ url: c.original, timestamp: c.timestamp, postHtml, parsed: story ?? null });
    } catch (e) {
      return NextResponse.json({ error: String(e) });
    }
  }

  const slice = candidates.slice(offset, offset + limit);
  const docs: unknown[] = [];
  const results: { headline?: string; slug?: string; skipped?: string; error?: string }[] = [];

  // Fetch 2 pages concurrently with a 500ms gap between waves — fast enough,
  // but gentle enough that Wayback doesn't drop connections.
  const CONCURRENCY = 2;
  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const wave = slice.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      wave.map(c =>
        fetchWayback(c.timestamp, c.original)
          .then(html => ({ ok: true as const, html, c }))
          .catch(e => ({ ok: false as const, error: String(e), c }))
      )
    );
    for (const r of settled) {
      if (!r.ok) { results.push({ error: r.error }); continue; }
      try {
        const story = parseGangreyPage(r.html, r.c.original, r.c.timestamp, r.c.dateHint);
        if (!story) { results.push({ skipped: r.c.original }); continue; }
        docs.push(toArchiveDoc(story));
        results.push({ headline: story.headline, slug: story.slug });
      } catch (e) {
        results.push({ error: String(e) });
      }
    }
    if (i + CONCURRENCY < slice.length) await sleep(500);
  }

  let written = 0;
  if (!dry && docs.length) {
    try { written = await writeDocs(docs); }
    catch (e) { return NextResponse.json({ error: `Archive write failed: ${String(e)}`, offset, results }, { status: 502 }); }
  }

  const nextOffset = offset + slice.length;
  return NextResponse.json({
    total: candidates.length,
    offset, limit,
    processed: slice.length,
    parsed: docs.length,
    written,
    nextOffset,
    done: nextOffset >= candidates.length,
    results,
  });
}
