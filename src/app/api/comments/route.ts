import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { rateLimit } from "@/lib/rateLimit";
import { isAuthed } from "@/lib/adminAuth";
import { sqliteCommentsForSlug, sqliteAddComment, sqliteDeleteComment, sqliteSetCommentApproved } from "@/lib/storage/sqlite";

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org").replace(/\/$/, "");
}

// Double opt-in: email the commenter a one-time link that publishes their
// comment (and confirms their address). Best-effort — a send failure leaves the
// comment unpublished rather than losing it.
async function sendCommentConfirmation(email: string, name: string, token: string) {
  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const from = process.env.NEWSLETTER_FROM ?? "Gangrey <hello@gangrey.org>";
  const link = `${siteUrl()}/api/comments/verify?token=${encodeURIComponent(token)}`;
  const first = (name || "").split(" ")[0] || "there";
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#000;">
    <p style="font-size:20px;line-height:1.35;margin:0 0 16px;">Confirm your comment, ${first}.</p>
    <p style="font-size:16px;line-height:1.7;color:#392a22;margin:0 0 22px;">Tap the button to publish your comment on Gangrey. This also adds you to our list — you can unsubscribe anytime.</p>
    <p style="margin:0 0 24px;"><a href="${link}" style="background:#490000;color:#fff;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;padding:12px 22px;border-radius:6px;display:inline-block;">Publish my comment</a></p>
    <p style="font-size:13px;line-height:1.6;color:#8a8a8c;margin:0;">If you didn't write this, ignore this email and nothing will be posted.</p>
  </div>`;
  await new Resend(apiKey).emails.send({ from, to: [email], subject: "Confirm your Gangrey comment", html });
}

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
  // Store unverified, then email a confirmation link that publishes it. No
  // manual approval — a real, confirmed address is the gate.
  const cleanEmail = email!.trim().slice(0, 120);
  const { token } = sqliteAddComment(slug, name.trim().slice(0, 80), text.trim().slice(0, 1000), cleanEmail);
  try { await sendCommentConfirmation(cleanEmail, name.trim(), token); } catch { /* best-effort */ }
  return NextResponse.json({ ok: true, verify: true });
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
