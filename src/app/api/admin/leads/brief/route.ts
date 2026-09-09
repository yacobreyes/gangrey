import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { getBrief } from "@/lib/leads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Today's brief: the short list a reporter reads at 7am. ?days=3 ?limit=10
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  return NextResponse.json(getBrief({
    days: q.get("days") ? Number(q.get("days")) : undefined,
    limit: q.get("limit") ? Number(q.get("limit")) : undefined,
  }));
}
