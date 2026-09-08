import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { importReport } from "@/lib/scoop/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual import: upload a report file (e.g. the Accela Daily Permit Report
// export, or a CivicData CSV downloaded by hand). Same pipeline as the
// automated fetch; the file itself is preserved under data/raw/.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    return NextResponse.json(importReport(buf, file.name, "manual"));
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
