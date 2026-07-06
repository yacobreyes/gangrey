import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { isSqliteBackend, sqliteAllViewCounts } from "@/lib/storage/sqlite";

// Admin-only: returns { slug: viewCount } for the Posts dashboard.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({}, { status: 401 });
  if (isSqliteBackend()) return NextResponse.json(sqliteAllViewCounts());
  return NextResponse.json({});
}
