import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { leaddeskUrl, leaddeskHeaders } from "@/lib/scoop/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Browser-collected records (the panel queries the city's ArcGIS server from
// the reporter's own connection when the VPS IP is WAF-blocked) — forwarded
// to the Lead Desk service.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.arrayBuffer();
    const r = await fetch(`${leaddeskUrl()}/import-json`, {
      method: "POST", headers: leaddeskHeaders({ "content-type": "application/json" }), body: Buffer.from(body), cache: "no-store",
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ error: "Lead Desk service unreachable. Is the leaddesk container running?" }, { status: 502 });
  }
}
