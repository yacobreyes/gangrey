import { NextRequest, NextResponse } from "next/server";
import { client } from "@/lib/sanity";
import { isAuthed } from "@/lib/adminAuth";
import { isSqliteBackend, sqliteGetDoc, sqliteDocsByType } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";

const NL_FIELDS = `_id, subject, preview, author, wordCount, cards, status, scheduledAt, createdAt, updatedAt, sentAt`;

async function versionsFor(newsletterId: string) {
  if (isSqliteBackend()) {
    return sqliteDocsByType<{ _id: string; newsletterId: string; createdAt?: string }>("newsletterVersion")
      .filter(v => v.newsletterId === newsletterId)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, 20)
      .map(({ _id, ...rest }) => ({ id: _id, ...rest }));
  }
  const raw: ({ _id: string } & Record<string, unknown>)[] = await client.fetch(
    `*[_type == "newsletterVersion" && newsletterId == $id] | order(createdAt desc)[0...20]{ _id, createdAt, subject, preview, author, wordCount, cards }`,
    { id: newsletterId },
    { cache: "no-store" }
  );
  return (raw ?? []).map(({ _id, ...rest }) => ({ id: _id, ...rest }));
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
    const draft = isSqliteBackend() ? sqliteGetDoc(id) : await client.fetch(`*[_id == $id][0]{ ${NL_FIELDS} }`, { id }, { cache: "no-store" });
    const versions = await versionsFor(id);
    return NextResponse.json({ draft: draft ?? null, versions });
  }
  const list = isSqliteBackend()
    ? sqliteDocsByType<{ updatedAt?: string; createdAt?: string }>("newsletter")
        .sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""))
    : await client.fetch(
        `*[_type == "newsletter"] | order(coalesce(updatedAt, createdAt) desc){ ${NL_FIELDS} }`,
        {},
        { cache: "no-store" }
      );
  return NextResponse.json({ newsletters: list ?? [] });
}
