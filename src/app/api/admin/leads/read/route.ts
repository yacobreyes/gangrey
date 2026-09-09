import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { readUnread, readerAvailable } from "@/lib/leads/reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Run the reader over unread records. Called by the panel after each load
// and by the publish cron after collection; idempotent (only unread rows).
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Math.min(80, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 40) || 40));
  try {
    const r = await readUnread(limit);
    return NextResponse.json({ ...r, available: readerAvailable() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ available: readerAvailable() });
}
