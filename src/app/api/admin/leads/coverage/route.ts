import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { leadsDb } from "@/lib/leads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Coverage check: has anyone already written about this address/project?
// Queries Google News search RSS (keyless, server-reachable) and caches per
// cluster so repeat opens don't refetch. Results are leads intelligence, not
// content — nothing here is republished.
type CoverageHit = { title: string; link: string; source: string; date: string };

function parseRss(xml: string): CoverageHit[] {
  const items: CoverageHit[] = [];
  const blocks = xml.split("<item>").slice(1);
  const pick = (block: string, tag: string) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() : "";
  };
  for (const b of blocks.slice(0, 6)) {
    const title = pick(b, "title");
    if (!title) continue;
    items.push({
      title,
      link: pick(b, "link"),
      source: pick(b, "source"),
      date: (() => { const d = new Date(pick(b, "pubDate")); return isNaN(+d) ? "" : d.toISOString().slice(0, 10); })(),
    });
  }
  return items;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { clusterKey, query, terms, cityDate } = await req.json() as { clusterKey?: string; query?: string; terms?: string[]; cityDate?: string };
    if (!clusterKey || !query) return NextResponse.json({ error: "clusterKey and query required" }, { status: 400 });

    const db = leadsDb();
    db.exec(`CREATE TABLE IF NOT EXISTS coverage (cluster_key TEXT PRIMARY KEY, checked_at TEXT NOT NULL, results_json TEXT NOT NULL)`);
    // Relevance gate: a headline counts only if it names the project (brand,
    // project name, or the street address) — "Kennedy" alone matched a 2024
    // steakhouse listicle. And a story more than ~13 months older than the
    // permit's own date cannot be coverage of this permit.
    const must = (terms ?? []).map(t => t.toLowerCase().trim()).filter(t => t.length >= 4);
    const floor = cityDate ? new Date(Date.parse(cityDate) - 400 * 86400_000).toISOString().slice(0, 10) : "";
    const gate = (h: CoverageHit) => {
      const t = h.title.toLowerCase();
      const named = must.length === 0 || must.some(m => t.includes(m));
      const fresh = !floor || !h.date || h.date >= floor;
      return named && fresh;
    };

    // Cache for 24h — coverage changes slowly and Google News is rate-limited.
    // Cached hits pass through the gate too, so earlier loose verdicts clean
    // up on the next open instead of lingering a day.
    const cached = db.prepare(`SELECT checked_at, results_json FROM coverage WHERE cluster_key = ?`).get(clusterKey) as { checked_at: string; results_json: string } | undefined;
    if (cached && Date.now() - Date.parse(cached.checked_at) < 24 * 3600 * 1000) {
      const cachedHits = (JSON.parse(cached.results_json) as CoverageHit[]).filter(gate);
      db.prepare(`UPDATE coverage SET results_json = ? WHERE cluster_key = ?`).run(JSON.stringify(cachedHits), clusterKey);
      return NextResponse.json({ hits: cachedHits, checkedAt: cached.checked_at, cached: true });
    }

    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query.slice(0, 120))}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; SunlandLeadDesk/1.0; +https://www.gangrey.org)" }, cache: "no-store" });
    if (!r.ok) return NextResponse.json({ error: `News search failed: HTTP ${r.status}` }, { status: 502 });
    const hits = parseRss(await r.text()).filter(gate);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO coverage (cluster_key, checked_at, results_json) VALUES (?, ?, ?)
                ON CONFLICT(cluster_key) DO UPDATE SET checked_at=excluded.checked_at, results_json=excluded.results_json`)
      .run(clusterKey, now, JSON.stringify(hits));
    return NextResponse.json({ hits, checkedAt: now, cached: false });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
