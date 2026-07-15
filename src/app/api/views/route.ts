import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { sqliteAllViewCounts } from "@/lib/storage/sqlite";

// Admin-only: returns { slug: viewCount } for the Posts dashboard.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({}, { status: 401 });
  return NextResponse.json(sqliteAllViewCounts());
}
