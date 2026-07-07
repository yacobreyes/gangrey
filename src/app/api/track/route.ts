import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import {
  isSqliteBackend, sqliteRecordEvent, sqliteGetPost, sqliteIncrementCount, sqlitePruneEvents,
} from "@/lib/storage/sqlite";

// Analytics ingestion — the Parse.ly-style event pipeline. Records a pageview
// ('v') or an engagement heartbeat ('e', carrying active-reading ms). Cookieless
// and PII-free: 'sid' is an ephemeral per-tab id; the IP is used only for rate
// limiting, never stored. Admin/CMS pages never call this.
export const dynamic = "force-dynamic";

function deviceFromUA(ua: string): "mobile" | "tablet" | "desktop" {
  if (/\b(ipad|tablet|playbook|silk)\b/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return "tablet";
  if (/\b(mobi|iphone|ipod|android.*mobile|windows phone)\b/i.test(ua)) return "mobile";
  return "desktop";
}

// Categorize a referrer hostname into a traffic channel, Parse.ly-style.
function sourceFromHost(host: string, selfHost: string): { host: string; source: string } {
  if (!host || host === selfHost || host.endsWith("." + selfHost)) return { host: "", source: "Direct" };
  const h = host.replace(/^www\./, "");
  const map: [RegExp, string][] = [
    [/(^|\.)google\./, "Google"], [/(^|\.)bing\./, "Bing"], [/(^|\.)duckduckgo\./, "DuckDuckGo"],
    [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "X / Twitter"], [/(^|\.)facebook\.com$|(^|\.)fb\./, "Facebook"],
    [/(^|\.)instagram\.com$/, "Instagram"], [/(^|\.)reddit\.com$/, "Reddit"], [/(^|\.)linkedin\.com$/, "LinkedIn"],
    [/(^|\.)news\.google\./, "Google News"], [/(^|\.)substack\.com$/, "Substack"], [/(^|\.)bsky\./, "Bluesky"],
    [/(^|\.)threads\.net$/, "Threads"], [/(^|\.)youtube\.com$/, "YouTube"],
  ];
  for (const [re, name] of map) if (re.test(h)) return { host: h, source: name };
  return { host: h, source: h };
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

export async function POST(req: NextRequest) {
  if (!isSqliteBackend()) return NextResponse.json({ ok: true });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(ip, "track", 600, 60 * 1000)) return NextResponse.json({ ok: false }, { status: 429 });

  let body: { s?: string; k?: string; sid?: string; r?: string; ms?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const slug = String(body.s ?? "").slice(0, 200);
  const session = String(body.sid ?? "").slice(0, 40);
  if (!slug) return NextResponse.json({ ok: false }, { status: 400 });

  const ua = req.headers.get("user-agent") ?? "";
  const device = deviceFromUA(ua);
  const now = Date.now();

  if (body.k === "e") {
    // Engagement heartbeat — clamp to a sane window (max 60s per beat).
    const engaged = Math.max(0, Math.min(60_000, Math.round(Number(body.ms) || 0)));
    if (engaged > 0) sqliteRecordEvent({ ts: now, kind: "engage", slug, session, device, engaged_ms: engaged });
    return NextResponse.json({ ok: true });
  }

  // Pageview: enrich with section/byline (server-side, trusted) + referrer channel.
  const selfHost = hostOf(process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org");
  const { host, source } = sourceFromHost(hostOf(String(body.r ?? "")), selfHost);
  const post = sqliteGetPost(slug);
  sqliteRecordEvent({
    ts: now, kind: "view", slug,
    section: post?.section ?? "", byline: post?.byline ?? "",
    ref_host: host, source, device, session,
  });

  // Keep the simple all-time counter (Audience top-5 / Posts column) in step,
  // deduped one-per-IP-per-slug-per-day so it stays a conservative number.
  if (rateLimit(`${ip}|${slug}`, "view-dedup", 1, 24 * 60 * 60 * 1000)) {
    sqliteIncrementCount(`views-${slug.replace(/[^a-zA-Z0-9-_]/g, "-")}`, 1);
  }

  // Opportunistic retention prune (~0.5% of pageviews) so the log stays bounded.
  if (Math.random() < 0.005) { try { sqlitePruneEvents(120); } catch {} }

  return NextResponse.json({ ok: true });
}
