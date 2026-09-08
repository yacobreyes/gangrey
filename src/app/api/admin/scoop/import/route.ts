import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { leaddeskUrl, leaddeskHeaders } from "@/lib/scoop/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual import — forwards the uploaded report to the Lead Desk service.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const r = await fetch(`${leaddeskUrl()}/import?filename=${encodeURIComponent(file.name)}`, {
      method: "POST", headers: leaddeskHeaders({ "content-type": "application/octet-stream" }), body: buf, cache: "no-store",
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ error: "Lead Desk service unreachable. Is the leaddesk container running?" }, { status: 502 });
  }
}
