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
    if (source !== "tampa" && source !== "hcfl") return NextResponse.json({ error: "Bad source" }, { status: 400 });
    const records = Array.isArray(body.records) ? body.records as Record<string, unknown>[] : [];
    if (!records.length) return NextResponse.json({ error: "No records" }, { status: 400 });
    if (records.length > 50_000) return NextResponse.json({ error: "Batch too large" }, { status: 400 });
    return NextResponse.json(ingestRecords(source, records));
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
