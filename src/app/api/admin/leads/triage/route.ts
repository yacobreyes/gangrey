import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { setTriage } from "@/lib/leads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The reporter's call on a lead: pursue, ignore, done, or clear.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json() as { clusterKey?: string; state?: string; note?: string };
    const state = body.state ?? "";
    if (!body.clusterKey || !["pursue", "ignore", "done", "clear"].includes(state)) {
      return NextResponse.json({ error: "clusterKey and state (pursue|ignore|done|clear) required" }, { status: 400 });
    }
    setTriage(body.clusterKey, state as "pursue" | "ignore" | "done" | "clear", String(body.note ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
