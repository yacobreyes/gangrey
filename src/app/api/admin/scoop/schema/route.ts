import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { schemaReport } from "@/lib/scoop/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Column inventory of the real imported data (original header names, fill
// rates, sample values) — the raw material for docs/TAMPA_DAILY_PERMIT_REPORT.md.
export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ columns: schemaReport() });
}
