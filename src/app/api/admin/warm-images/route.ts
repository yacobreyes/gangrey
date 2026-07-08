import { NextResponse } from "next/server";
import { requireAdminOrCronSecret } from "@/lib/adminAuth";
import { isSqliteBackend, sqliteAllPostsAdminLight } from "@/lib/storage/sqlite";
import { postImageUrl } from "@/lib/sanityImage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// One-time (re-runnable) bulk pre-generation of every story's image
// derivatives, so no reader ever waits on a cold sharp resize. Needed because
// the ~2,500-story archive import never ran the on-publish warm step, and the
// responsive hero srcset added new sizes (800×450, 1200×675) that existing
// stories had never generated.
//
// Idempotent: the /media route caches each derivative to disk (in the mounted
// /data volume, so it survives deploys) and serves the cache on any repeat, so
// re-running only fills gaps. Throttled to a small concurrency so a 2-vCPU box
// isn't OOM'd by parallel sharp resizes.
//
// POST /api/admin/warm-images?offset=0&limit=300  (loop until done:false)

// Exactly the sizes the public site requests, so warmed keys match browser keys.
const SIZES: [number, number][] = [
  [1600, 900],   // hero srcset large
  [1200, 675],   // hero srcset medium (mobile hi-dpi)
  [800, 450],    // hero srcset small (mobile)
  [1200, 630],   // OG / social card
  [720, 540],    // list thumbnail
  [640, 474],
  [520, 293],
];

async function warmOne(base: string, image: { url?: string; crops?: unknown }): Promise<void> {
  for (const [w, h] of SIZES) {
    const u = postImageUrl(image as never, w, h);
    if (!u) continue;
    try { await fetch(`${base}${u}`, { cache: "no-store" }); } catch { /* ignore */ }
  }
}

export async function POST(req: Request) {
  await requireAdminOrCronSecret(req);
  if (!isSqliteBackend()) return NextResponse.json({ error: "sqlite-only" }, { status: 400 });

  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 300));
  // Warm against the app's own origin (self-host: localhost inside the container).
  const base = `http://localhost:${process.env.PORT ?? 3000}`;

  const all = sqliteAllPostsAdminLight().filter(p => p.image?.url?.startsWith("/media/"));
  const batch = all.slice(offset, offset + limit);

  // Small concurrency so parallel sharp resizes don't thrash a 2-vCPU box.
  const CONCURRENCY = 3;
  let i = 0;
  async function worker() {
    while (i < batch.length) {
      const p = batch[i++];
      if (p.image) await warmOne(base, p.image as { url?: string; crops?: unknown });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const nextOffset = offset + batch.length;
  return NextResponse.json({
    ok: true,
    total: all.length,
    warmed: batch.length,
    nextOffset,
    done: nextOffset >= all.length,
  });
}
