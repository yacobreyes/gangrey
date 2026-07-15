import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { sqliteIncrementCount } from "@/lib/storage/sqlite";

// Records a story page view in our own datastore (no third party). Called once
// per story load by StoryVisitTracker. Admin-only pages never call this.
export const dynamic = "force-dynamic";

function viewId(slug: string) {
  return `views-${slug.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // Generous cap — just enough to blunt obvious hammering, not real readers.
  if (!rateLimit(ip, "views", 120, 60 * 1000)) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const { slug } = await req.json().catch(() => ({ slug: "" })) as { slug?: string };
  if (!slug) return NextResponse.json({ ok: false }, { status: 400 });
  // Server-side dedup backstop: the same IP can count a given story at most
  // once per 24h, even if the client's localStorage dedup was cleared.
  // (In-memory, so it resets on redeploy — fine for a backstop.)
  if (!rateLimit(`${ip}|${slug}`, "view-dedup", 1, 24 * 60 * 60 * 1000)) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  const count = sqliteIncrementCount(viewId(slug), 1);
  return NextResponse.json({ ok: true, count });
}
