import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { saveContexts, type ParcelContext } from "@/lib/leads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parcel context collected in the browser from the Property Appraiser's
// public HCPA_Parcels_All layer: owner, DBA, values, last sale, year built.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json() as { items?: ParcelContext[] };
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    return NextResponse.json({ saved: saveContexts(items) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
