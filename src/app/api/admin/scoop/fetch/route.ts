import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { leaddeskUrl, leaddeskHeaders } from "@/lib/scoop/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Fetch now" — asks the standalone Lead Desk service to run its collectors.
export async function POST() {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const r = await fetch(`${leaddeskUrl()}/collect`, { method: "POST", headers: leaddeskHeaders(), cache: "no-store" });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ error: "Lead Desk service unreachable. Is the leaddesk container running?" }, { status: 502 });
  }
}
