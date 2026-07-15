import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { isAuthed } from "@/lib/adminAuth";
import { sqliteCommentsForSlug, sqliteAddComment, sqliteDeleteComment, sqliteSetCommentApproved } from "@/lib/storage/sqlite";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json([]);
  return NextResponse.json(sqliteCommentsForSlug(slug).map(c => ({ _id: c._id, name: c.name, text: c.text, _createdAt: c._createdAt })));
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(ip, "comments", 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many comments. Try again later." }, { status: 429 });
  }
  const { slug, name, email, text, website } = await req.json() as { slug: string; name: string; email?: string; text: string; website?: string };
  // Honeypot: a hidden "website" field no human ever fills. Bots auto-complete
  // it — when it's non-empty, pretend success but store nothing.
  if (website && website.trim()) return NextResponse.json({ ok: true, pending: true });
  const emailOk = !!email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  if (!slug || !name?.trim() || !emailOk || !text?.trim()) {
    return NextResponse.json({ error: "Name, a valid email, and a comment are required." }, { status: 400 });
  }
  // New comments arrive pending; an admin approves them before they appear.
  sqliteAddComment(slug, name.trim().slice(0, 80), text.trim().slice(0, 1000), email.trim().slice(0, 120));
  return NextResponse.json({ ok: true, pending: true });
}

// Approve a pending comment (admin only).
export async function PATCH(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, approved } = await req.json() as { id: string; approved?: boolean };
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  sqliteSetCommentApproved(id, approved !== false);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  // Deleting a comment is an admin action — must be authenticated.
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json() as { id: string };
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  sqliteDeleteComment(id);
  return NextResponse.json({ ok: true });
}
