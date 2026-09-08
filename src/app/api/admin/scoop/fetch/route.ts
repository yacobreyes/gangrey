import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { fetchLatestReport } from "@/lib/scoop/fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The permits CSV is several MB and the diff walks every row.
export const maxDuration = 300;

// "Fetch now": pull the latest City of Tampa permits CSV from the public
// CivicData feed and run the import pipeline on it.
export async function POST() {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchLatestReport());
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
