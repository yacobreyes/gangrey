import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { getQueue, collectState } from "@/lib/leads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The ranked reporting queue. Filters: ?new=1 ?changed=1 ?restaurants=1
// ?development=1 ?minScore=8 ?days=7 ?source=tampa|hcfl
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const data = getQueue({
    uncovered: q.get("uncovered") === "1",
    sort: q.get("sort") === "score" ? "score" : "date",
    sinceDays: q.get("days") ? Number(q.get("days")) : undefined,
    onlyNew: q.get("new") === "1",
    onlyChanged: q.get("changed") === "1",
    restaurants: q.get("restaurants") === "1",
    development: q.get("development") === "1",
    minScore: q.get("minScore") ? Number(q.get("minScore")) : undefined,
    source: (q.get("source") === "tampa" || q.get("source") === "hcfl") ? (q.get("source") as "tampa" | "hcfl") : undefined,
  });
  return NextResponse.json({ ...data, state: collectState() });
}
