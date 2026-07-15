import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { isAuthed } from "@/lib/adminAuth";
import { sqliteCommentsForSlug, sqliteAddComment, sqliteDeleteComment, sqliteSetCommentApproved, sqliteMutate } from "@/lib/storage/sqlite";
import { subscriberIdForEmail } from "@/lib/membership";

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
  // Post immediately and subscribe the commenter (idempotent — never clobbers
  // an existing subscriber). No approval step; delete after the fact instead.
  const cleanEmail = email!.trim().toLowerCase().slice(0, 120);
  sqliteAddComment(slug, name.trim().slice(0, 80), text.trim().slice(0, 1000), cleanEmail);
  try {
    sqliteMutate([{ createIfNotExists: {
      _id: subscriberIdForEmail(cleanEmail), _type: "subscriber",
      email: cleanEmail, status: "neutral", createdAt: new Date().toISOString(),
    } }]);
  } catch { /* subscribing is best-effort; the comment still posts */ }
  return NextResponse.json({ ok: true, published: true });
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
