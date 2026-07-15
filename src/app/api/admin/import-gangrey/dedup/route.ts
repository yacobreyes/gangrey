import { NextResponse } from "next/server";
import { requireAdminOrCronSecret } from "@/lib/adminAuth";
import { normalizeHeadline } from "@/lib/gangreyDedup";
import { sqliteAllPostsAdmin, sqliteMutate } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try { await requireAdminOrCronSecret(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  // Run the duplicate-collapse against the local SQLite posts.
  const archive = sqliteAllPostsAdmin()
    .filter(p => p.section === "Archive")
    .map(p => ({ _id: p._id, headline: p.headline, byline: p.byline || undefined, slug: { current: p.slug } }));
  const groups = new Map<string, typeof archive>();
  for (const doc of archive) {
    const key = normalizeHeadline(doc.headline ?? "");
    if (!key) continue;
    const g = groups.get(key) ?? [];
    g.push(doc);
    groups.set(key, g);
  }
  const toDelete: string[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      if (!!a.byline !== !!b.byline) return a.byline ? -1 : 1;
      const aIsP = /^gangrey-p\d+$/.test(a.slug?.current ?? "");
      const bIsP = /^gangrey-p\d+$/.test(b.slug?.current ?? "");
      if (aIsP !== bIsP) return aIsP ? 1 : -1;
      return 0;
    });
    for (const doc of group.slice(1)) toDelete.push(doc._id);
  }
  if (toDelete.length) sqliteMutate(toDelete.map(id => ({ delete: { id } })));
  return NextResponse.json({ deleted: toDelete.length, total: archive.length, kept: archive.length - toDelete.length });
}
