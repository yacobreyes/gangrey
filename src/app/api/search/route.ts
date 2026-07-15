import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { isSqliteBackend, sqliteSearchPosts } from "@/lib/storage/sqlite";

// Server-side full-text search over posts (SQLite FTS5). Public scope returns
// only reader-visible posts; the admin scope (auth-gated) searches everything.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isSqliteBackend()) return NextResponse.json({ results: [] });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ results: [] });

  const scope = req.nextUrl.searchParams.get("scope") ?? "public";
  const section = req.nextUrl.searchParams.get("section") ?? undefined;
  const limit = Math.min(100, Number(req.nextUrl.searchParams.get("limit")) || 50);

  // "all" (every status) is admin-only; anonymous callers get public results.
  const admin = scope === "all" && (await isAuthed());
  const results = sqliteSearchPosts(q, { limit, publicOnly: !admin, section });
  return NextResponse.json({ results });
}
