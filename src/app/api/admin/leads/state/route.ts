import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { collectState } from "@/lib/leads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tells the panel's browser collector how far back each feed needs fetching.
export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(collectState());
}
