import { NextResponse } from "next/server";
import { requireAdminOrCronSecret } from "@/lib/adminAuth";
import { sqliteAllPostsAdmin } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try { await requireAdminOrCronSecret(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  // Count archive posts straight out of SQLite.
  const count = sqliteAllPostsAdmin().filter(p => p.section === "Archive" && p.status === "published").length;
  return NextResponse.json({ count });
}
