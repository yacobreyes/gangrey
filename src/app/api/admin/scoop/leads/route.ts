import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { getLeads, lastImports, queueBands } from "@/lib/scoop/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The reporting queue. Filters mirror the CLI spec:
//   ?new=1  ?changed=1  ?restaurants=1  ?development=1  ?minScore=8  ?days=7
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const leads = getLeads({
    sinceDays: q.get("days") ? Number(q.get("days")) : undefined,
    onlyNew: q.get("new") === "1",
    onlyChanged: q.get("changed") === "1",
    restaurants: q.get("restaurants") === "1",
    development: q.get("development") === "1",
    minScore: q.get("minScore") ? Number(q.get("minScore")) : undefined,
  });
  return NextResponse.json({ leads: leads.slice(0, 200), total: leads.length, bands: queueBands(leads), imports: lastImports(8) });
}
