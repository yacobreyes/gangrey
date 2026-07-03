import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { sanityConfig } from "@/lib/sanityWrite";
import { normalizeHeadline } from "@/lib/gangreyDedup";
import fixes from "@/lib/gangreyFixes.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Applies harvested publication dates + bylines to the imported Gangrey
// archive. The heavy lifting (crawling Wayback feeds/monthly archives) was done
// offline — this route just matches the committed fix file against the live
// docs and patches them. Idempotent; re-running is a no-op once applied.
//
//   GET /api/admin/fix-archive-meta?dry=1          preview counts, change nothing
//   GET /api/admin/fix-archive-meta                apply (batched internally)
//   GET /api/admin/fix-archive-meta?forcebylines=1 also overwrite non-empty bylines
//
// Dates are always overwritten when a harvested date exists — the imported
// dates are Wayback crawl timestamps, i.e. known-wrong. Bylines only fill
// empty fields unless forcebylines=1, so manual fixes are preserved.

type Fix = { d?: string; b?: string; pri?: number };
const BY_SLUG = (fixes as { bySlug: Record<string, Fix> }).bySlug ?? {};
const BY_HEADLINE = (fixes as { byHeadline: Record<string, Fix> }).byHeadline ?? {};

// WordPress usernames → display bylines, from the harvested creator list.
// "ben" is Ben Montgomery, gangrey.com's founder; "t lake"/"t.lake" is Thomas
// Lake and "kruse" is Michael Kruse, both longtime gangrey contributors.
// Ambiguous single-name usernames (jones, wright, seth w., tlohnd…) are left
// unmapped and just title-cased — extend this map as identities are confirmed.
const DISPLAY_NAMES: Record<string, string> = {
  "ben": "Ben Montgomery",
  "t lake": "Thomas Lake",
  "t.lake": "Thomas Lake",
  "kruse": "Michael Kruse",
  "janine": "Janine Anderson",
  "janine anderson": "Janine Anderson",
  "mark johnson": "Mark Johnson",
  "bill marvel": "Bill Marvel",
  "matt tullis": "Matt Tullis",
  "si rosenbaum": "S.I. Rosenbaum",
  "anonymous": "Anonymous",
};

function displayByline(username?: string): string {
  const u = (username ?? "").trim().toLowerCase();
  if (!u) return "";
  if (DISPLAY_NAMES[u]) return DISPLAY_NAMES[u];
  return u.split(/[\s._-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function findFix(slug: string, headline: string): Fix | null {
  if (BY_SLUG[slug]) return BY_SLUG[slug];
  // The import prefixed ids two ways over time (gangrey-123 / gangrey-p123).
  const alt = slug.startsWith("gangrey-p") ? slug.replace(/^gangrey-p/, "gangrey-") : slug.replace(/^gangrey-/, "gangrey-p");
  if (BY_SLUG[alt]) return BY_SLUG[alt];
  const hn = normalizeHeadline(headline);
  if (hn && BY_HEADLINE[hn]) return BY_HEADLINE[hn];
  return null;
}

export async function GET(req: NextRequest) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const forceBylines = url.searchParams.get("forcebylines") === "1";

  const { token, projectId, dataset } = sanityConfig();
  const base = `https://${projectId}.api.sanity.io/v2024-01-01/data`;

  // Only fields we need — keeps 2,500 docs comfortably inside one response.
  const q = encodeURIComponent(`*[_type=="post" && section=="Archive"]{_id, "slug": slug.current, headline, date, byline}`);
  const res = await fetch(`${base}/query/${dataset}?query=${q}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 502 });
  const { result } = await res.json() as { result: { _id: string; slug: string; headline: string; date?: string; byline?: string }[] };
  if (!result?.length) return NextResponse.json({ examined: 0, message: "No archive posts found" });

  const patches: { id: string; set: Record<string, string> }[] = [];
  let matched = 0;
  const unmatched: string[] = [];

  for (const doc of result) {
    const fix = findFix(doc.slug ?? "", doc.headline ?? "");
    if (!fix) { unmatched.push(doc.slug ?? doc._id); continue; }
    matched++;
    const set: Record<string, string> = {};
    if (fix.d && fix.d.slice(0, 10) !== (doc.date ?? "").slice(0, 10)) set.date = fix.d;
    const newByline = displayByline(fix.b);
    if (newByline && (forceBylines || !(doc.byline ?? "").trim()) && newByline !== doc.byline) set.byline = newByline;
    if (Object.keys(set).length) patches.push({ id: doc._id, set });
  }

  if (dry) {
    return NextResponse.json({
      dry: true,
      examined: result.length,
      matched,
      wouldPatch: patches.length,
      unmatchedCount: unmatched.length,
      unmatchedSample: unmatched.slice(0, 20),
      sample: patches.slice(0, 10),
    });
  }

  let patched = 0;
  for (let i = 0; i < patches.length; i += 100) {
    const batch = patches.slice(i, i + 100).map(p => ({ patch: { id: p.id, set: p.set } }));
    const r = await fetch(`${base}/mutate/${dataset}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mutations: batch }),
    });
    if (!r.ok) return NextResponse.json({ error: await r.text(), patched }, { status: 502 });
    patched += batch.length;
  }

  return NextResponse.json({
    examined: result.length,
    matched,
    patched,
    unmatchedCount: unmatched.length,
    unmatchedSample: unmatched.slice(0, 20),
  });
}
