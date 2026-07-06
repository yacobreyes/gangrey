import { NextResponse } from "next/server";
import { requireAdminOrCronSecret } from "@/lib/adminAuth";
import { normalizeHeadline } from "@/lib/gangreyDedup";
import { isSqliteBackend, sqliteAllPostsAdmin, sqliteMutate } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try { await requireAdminOrCronSecret(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  // Self-hosted: run the same duplicate-collapse against the local SQLite posts.
  if (isSqliteBackend()) {
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

  const token = process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_WRITE_TOKEN;
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  if (!token || !projectId) return NextResponse.json({ error: "Missing Sanity credentials" }, { status: 500 });

  const base = `https://${projectId}.api.sanity.io/v2024-01-01/data`;

  // Fetch all Archive docs
  const q = encodeURIComponent(`*[_type=="post" && section=="Archive"]{_id, headline, byline, slug}`);
  const res = await fetch(`${base}/query/${dataset}?query=${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return NextResponse.json({ error: `Sanity query failed: ${await res.text()}` }, { status: 502 });
  const { result } = await res.json() as { result: { _id: string; headline: string; byline?: string; slug?: { current?: string } }[] };

  // Group by normalized headline, pick winner (prefers byline; among ties, prefer path slug over p-slug)
  const groups = new Map<string, typeof result>();
  for (const doc of result) {
    const key = normalizeHeadline(doc.headline ?? "");
    if (!key) continue;
    const g = groups.get(key) ?? [];
    g.push(doc);
    groups.set(key, g);
  }

  const toDelete: string[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    // Sort: docs with byline first, then prefer non-p-prefixed slugs
    group.sort((a, b) => {
      if (!!a.byline !== !!b.byline) return a.byline ? -1 : 1;
      const aSlug = a.slug?.current ?? "";
      const bSlug = b.slug?.current ?? "";
      const aIsP = /^gangrey-p\d+$/.test(aSlug);
      const bIsP = /^gangrey-p\d+$/.test(bSlug);
      if (aIsP !== bIsP) return aIsP ? 1 : -1;
      return 0;
    });
    // Keep index 0, delete the rest
    for (const doc of group.slice(1)) toDelete.push(doc._id);
  }

  if (!toDelete.length) return NextResponse.json({ deleted: 0, message: "No duplicates found" });

  // Delete in batches of 100
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    const mutations = batch.map(id => ({ delete: { id } }));
    const r = await fetch(`${base}/mutate/${dataset}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mutations }),
    });
    if (!r.ok) return NextResponse.json({ error: `Delete failed at batch ${i}: ${await r.text()}`, deleted }, { status: 502 });
    deleted += batch.length;
  }

  return NextResponse.json({ deleted, total: result.length, kept: result.length - deleted });
}
