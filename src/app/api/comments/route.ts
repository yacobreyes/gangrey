import { NextRequest, NextResponse } from "next/server";
import { client } from "@/lib/sanity";
import { rateLimit } from "@/lib/rateLimit";
import { isAuthed } from "@/lib/adminAuth";
import { isSqliteBackend, sqliteCommentsForSlug, sqliteAddComment, sqliteDeleteComment, sqliteSetCommentApproved } from "@/lib/storage/sqlite";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
const token = () => process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_WRITE_TOKEN ?? "";

async function mutate(mutations: unknown[]) {
  const res = await fetch(
    `https://${projectId}.api.sanity.io/v2024-01-01/data/mutate/${dataset}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ mutations }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json([]);
  if (isSqliteBackend()) {
    return NextResponse.json(sqliteCommentsForSlug(slug).map(c => ({ _id: c._id, name: c.name, text: c.text, _createdAt: c._createdAt })));
  }
  const comments = await client.fetch(
    `*[_type == "comment" && slug == $slug && approved == true] | order(_createdAt asc) { _id, name, text, _createdAt }`,
    { slug },
    { cache: "no-store" }
  );
  return NextResponse.json(comments ?? []);
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(ip, "comments", 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many comments. Try again later." }, { status: 429 });
  }
  const { slug, name, text } = await req.json() as { slug: string; name: string; text: string };
  if (!slug || !name?.trim() || !text?.trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  // New comments arrive pending; an admin approves them before they appear.
  if (isSqliteBackend()) {
    sqliteAddComment(slug, name.trim().slice(0, 80), text.trim().slice(0, 1000));
    return NextResponse.json({ ok: true, pending: true });
  }
  await mutate([{
    create: {
      _type: "comment",
      slug,
      name: name.trim().slice(0, 80),
      text: text.trim().slice(0, 1000),
      approved: false,
    },
  }]);
  return NextResponse.json({ ok: true, pending: true });
}

// Approve a pending comment (admin only).
export async function PATCH(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, approved } = await req.json() as { id: string; approved?: boolean };
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const value = approved !== false;
  if (isSqliteBackend()) { sqliteSetCommentApproved(id, value); return NextResponse.json({ ok: true }); }
  await mutate([{ patch: { id, set: { approved: value } } }]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  // Deleting a comment is an admin action — must be authenticated.
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (isSqliteBackend()) { sqliteDeleteComment(id); return NextResponse.json({ ok: true }); }
  await mutate([{ delete: { id } }]);
  return NextResponse.json({ ok: true });
}
