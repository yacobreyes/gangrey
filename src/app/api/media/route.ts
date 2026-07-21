import { isAuthed } from "@/lib/adminAuth";
import { getMediaLibrary } from "@/lib/content";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json([], { status: 401 });
  try {
    return NextResponse.json(await getMediaLibrary());
  } catch {
    return NextResponse.json([]);
  }
}
