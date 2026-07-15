import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireAdminOrCronSecret } from "@/lib/adminAuth";
import { sqliteReplaceArchive, sqliteArchivePostsForFixes } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Full, clean rebuild of the Gangrey archive from scripts/archive-rebuild.json
// (every post keyed by its real WordPress post-id, so headline/date/byline/body
// all come from the same source page — no slug↔post mismatch).
//
// Dry-run by default: shows the current vs incoming counts and the incoming
// earliest posts. Pass ?apply=1 to WIPE section='Archive' and re-insert.
//
//   POST /api/admin/rebuild-archive            (dry run)
//   POST /api/admin/rebuild-archive?apply=1    (wipe + rebuild)

type Rec = { slug: string; headline: string; byline: string; date: string; readingTime?: number; body: unknown[] };

function loadDataset(): Rec[] {
  const p = path.join(process.cwd(), "scripts", "archive-rebuild.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Rec[];
}

export async function POST(req: NextRequest) {
  await requireAdminOrCronSecret(req);
  const apply = req.nextUrl.searchParams.get("apply") === "1";

  let dataset: Rec[];
  try {
    dataset = loadDataset();
  } catch (e) {
    return NextResponse.json({ error: "dataset not found — is scripts/archive-rebuild.json in the image?", detail: String(e) }, { status: 500 });
  }

  const currentCount = sqliteArchivePostsForFixes().length;
  const sorted = [...dataset].sort((a, b) => a.date.localeCompare(b.date));
  const earliest = sorted.slice(0, 10).map(r => ({ date: r.date.slice(0, 10), byline: r.byline, headline: r.headline, paras: (r.body ?? []).length }));
  const latest = sorted.slice(-5).map(r => ({ date: r.date.slice(0, 10), byline: r.byline, headline: r.headline }));
  const bylineDist: Record<string, number> = {};
  for (const r of dataset) bylineDist[r.byline] = (bylineDist[r.byline] ?? 0) + 1;
  const topBylines = Object.entries(bylineDist).sort((a, b) => b[1] - a[1]).slice(0, 15);

  let result: { deleted: number; inserted: number } | null = null;
  if (apply) result = sqliteReplaceArchive(dataset);

  return NextResponse.json({
    ok: true,
    mode: apply ? "REBUILT" : "dry-run (pass ?apply=1 to wipe + rebuild)",
    currentArchivePosts: currentCount,
    incomingPosts: dataset.length,
    ...(result ? { deleted: result.deleted, inserted: result.inserted } : {}),
    bylineDistribution: Object.fromEntries(topBylines),
    earliest,
    latest,
  });
}
