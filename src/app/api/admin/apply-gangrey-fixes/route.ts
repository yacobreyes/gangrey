import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrCronSecret } from "@/lib/adminAuth";
import { isSqliteBackend, sqliteArchivePostsForFixes, sqliteSetDateByline, sqliteSetStatus } from "@/lib/storage/sqlite";
import fixes from "@/lib/gangreyFixes.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Corrects imported Gangrey archive posts' publish dates and bylines from the
// Wayback harvest (src/lib/gangreyFixes.json — dates + WP-author usernames per
// ?p=N slug, back to June 2005).
//
// Dry-run by default: GET/POST returns exactly what WOULD change. Pass
// ?apply=1 to write. Idempotent — re-running only touches rows still off.
//
//   POST /api/admin/apply-gangrey-fixes                       (dry run, report)
//   POST /api/admin/apply-gangrey-fixes?apply=1               (write fixes)
//   POST /api/admin/apply-gangrey-fixes?trashUnmatched=1      (dry run: list them)
//   POST /api/admin/apply-gangrey-fixes?trashUnmatched=1&apply=1  (trash them)
//
// Unmatched = archive posts with no Wayback record at all (never captured as
// their own page — the import scraped them off listing pages, so their dates
// are fabricated). Editorial call: those get trashed (status='trashed',
// reversible from Imago's Trash), and the response lists every one by name.

type Fix = { d?: string; b?: string };
const bySlug = (fixes as { bySlug?: Record<string, Fix> }).bySlug ?? {};
const byHeadline = (fixes as { byHeadline?: Record<string, Fix> }).byHeadline ?? {};

// WP usernames → display bylines. The old gangrey.com was Ben's blog; the
// byline credits who POSTED the piece. Full names for the regulars; obvious
// full names elsewhere are just title-cased; junk scraped strings are skipped.
const NAME_MAP: Record<string, string> = {
  "ben": "Ben Montgomery",
  "t lake": "Thomas Lake", "t.lake": "Thomas Lake", "tom lake": "Thomas Lake", "tlohnd": "Thomas Lake",
  "kruse": "Michael Kruse",
  "janine anderson": "Janine Anderson",
  "mark johnson": "Mark Johnson",
  "eva holland": "Eva Holland",
};
// Bylines that are clearly not people (scraped titles / spam) — leave the
// post's existing byline untouched, but still fix its date.
const JUNK = new Set([
  "6 questions journalists should be able to answer before pitching a story &#124; coppelljournalism",
  "partlow funeral home",
]);

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, m => m.toUpperCase());
}

// Resolve a harvested raw byline to a SAFE display form, or null to skip
// (leaving the post's existing byline untouched). We only write when confident:
//   - a mapped regular (ben → Ben Montgomery, kruse → Michael Kruse, …), or
//   - a harvested value that already looks like a real full name (has a space:
//     "paige williams" → "Paige Williams").
// Bare one-word usernames (emw, zack, ramsey, reiter…) are NOT trustworthy —
// writing them would clobber a good existing byline (e.g. "Justin Heckert" →
// "Emw"), so those are skipped and the current byline is kept.
function displayByline(raw?: string): string | null {
  const b = (raw ?? "").trim();
  if (!b || JUNK.has(b)) return null;
  if (NAME_MAP[b]) return NAME_MAP[b];
  if (/\s/.test(b)) return titleCase(b); // multi-word → a real name
  return null;                            // lone username → don't trust it
}

function normHeadline(s: string): string {
  return s.toLowerCase().replace(/&#\d+;|&\w+;/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  await requireAdminOrCronSecret(req);
  if (!isSqliteBackend()) return NextResponse.json({ error: "sqlite-only" }, { status: 400 });
  const apply = req.nextUrl.searchParams.get("apply") === "1";
  const trashUnmatched = req.nextUrl.searchParams.get("trashUnmatched") === "1";

  const posts = sqliteArchivePostsForFixes();
  let matched = 0, dateChanges = 0, bylineChanges = 0, unmatched = 0, written = 0, trashed = 0;
  const bylineDist: Record<string, number> = {};
  const samples: { headline: string; oldDate: string; newDate?: string; oldByline: string; newByline?: string }[] = [];
  const unmatchedSample: string[] = [];
  const unmatchedAll: string[] = [];

  for (const p of posts) {
    // Match by slug first (gangrey-pN / gangrey-N), then by normalized headline.
    const fix = bySlug[p.slug] ?? byHeadline[normHeadline(p.headline)];
    if (!fix) {
      unmatched++;
      unmatchedAll.push(`${p.headline || "(no headline)"} [${p.slug}, dated ${p.date.slice(0, 10) || "?"}]`);
      if (unmatchedSample.length < 25) unmatchedSample.push(`${p.slug} — ${p.headline}`);
      if (trashUnmatched && apply) {
        sqliteSetStatus(p.id, "trashed");
        trashed++;
      }
      continue;
    }
    matched++;

    // Date: harvest is ISO; only change if meaningfully different (ignore
    // sub-day noise — imported dates were date-only).
    let newDate: string | undefined;
    if (fix.d && fix.d.slice(0, 10) !== (p.date || "").slice(0, 10)) newDate = fix.d;

    // Byline.
    let newByline: string | undefined;
    const disp = displayByline(fix.b);
    if (disp && disp !== p.byline) newByline = disp;
    if (disp) bylineDist[disp] = (bylineDist[disp] ?? 0) + 1;

    if (newDate) dateChanges++;
    if (newByline) bylineChanges++;

    if ((newDate || newByline) && samples.length < 40) {
      samples.push({ headline: p.headline, oldDate: p.date, newDate, oldByline: p.byline, newByline });
    }

    if (apply && (newDate || newByline)) {
      sqliteSetDateByline(p.id, newDate, newByline);
      written++;
    }
  }

  const topBylines = Object.entries(bylineDist).sort((a, b) => b[1] - a[1]).slice(0, 20);

  return NextResponse.json({
    ok: true,
    mode: apply ? "APPLIED" : "dry-run (pass ?apply=1 to write)",
    archivePosts: posts.length,
    matched,
    unmatched,
    wouldChangeDate: dateChanges,
    wouldChangeByline: bylineChanges,
    written,
    trashed,
    bylineDistribution: Object.fromEntries(topBylines),
    sampleChanges: samples,
    // With ?trashUnmatched=1 the response carries EVERY unmatched post by
    // name — the record of what was (or would be) trashed.
    ...(trashUnmatched ? { unmatchedAll } : { unmatchedSample }),
  });
}
