import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { sqliteGetDoc, sqliteDocsByType } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";

async function versionsFor(newsletterId: string) {
  return sqliteDocsByType<{ _id: string; newsletterId: string; createdAt?: string }>("newsletterVersion")
    .filter(v => v.newsletterId === newsletterId)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 20)
    .map(({ _id, ...rest }) => ({ id: _id, ...rest }));
}

// GET            → list all newsletters (for the dashboard)
// GET ?id=<id>   → a single newsletter draft + its version history
//
// Admin-only: newsletters include unsent drafts, so this must not be public.
// Writes/deletes go through the auth-gated `saveNewsletter` / `deleteNewsletter`
// server actions, not this route.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const draft = sqliteGetDoc(id);
    const versions = await versionsFor(id);
    return NextResponse.json({ draft: draft ?? null, versions });
  }
  const list = sqliteDocsByType<{ updatedAt?: string; createdAt?: string }>("newsletter")
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""));
  return NextResponse.json({ newsletters: list ?? [] });
}
