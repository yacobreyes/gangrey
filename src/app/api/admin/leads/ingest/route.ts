import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { ingestRecords, type SourceId } from "@/lib/leads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Receives raw feed records collected in the reporter's browser (the feeds
// 403 the VPS's datacenter IP but serve residential connections; ArcGIS
// publishes CORS headers so browser apps can query it).
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json() as { source?: string; records?: unknown[] };
    const source = body.source as SourceId;
    if (!["tampa", "hcfl", "hcdev", "tampaent", "tampaab"].includes(source)) return NextResponse.json({ error: "Bad source" }, { status: 400 });
    const records = Array.isArray(body.records) ? body.records as Record<string, unknown>[] : [];
    // An empty batch is a successful check that found nothing new — record
    // the collection time so the panel shows when the feed was last checked.
    if (!records.length) {
      const { leadsDb } = await import("@/lib/leads/store");
      leadsDb().prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(`last_collect_${source}`, new Date().toISOString());
      return NextResponse.json({ alreadyIngested: false, rowCount: 0, inserted: 0, changed: 0, unchanged: 0, skipped: 0 });
    }
    if (records.length > 50_000) return NextResponse.json({ error: "Batch too large" }, { status: 400 });
    return NextResponse.json(ingestRecords(source, records));
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
