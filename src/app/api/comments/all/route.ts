import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { sqliteAllComments } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";

export async function GET() {
  const authed = await isAuthed();
  if (!authed) return NextResponse.json([], { status: 401 });
  return NextResponse.json(sqliteAllComments());
}
