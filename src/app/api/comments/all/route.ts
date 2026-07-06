import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import { client } from "@/lib/sanity";
import { isSqliteBackend, sqliteAllComments } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";

export async function GET() {
  const authed = await isAuthed();
  if (!authed) return NextResponse.json([], { status: 401 });
  if (isSqliteBackend()) return NextResponse.json(sqliteAllComments());

  const comments = await client.fetch(
    `*[_type == "comment"] | order(_createdAt desc) { _id, name, email, text, slug, approved, _createdAt }`,
    {},
    { cache: "no-store" }
  );
  return NextResponse.json(comments ?? []);
}
