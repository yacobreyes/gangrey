import { NextRequest, NextResponse } from "next/server";
import { sqliteVerifyComment, sqliteMutate } from "@/lib/storage/sqlite";
import { subscriberIdForEmail } from "@/lib/membership";

export const dynamic = "force-dynamic";

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org").replace(/\/$/, "");
}

// The link from the confirmation email. Publishes the comment (proving the
// address is real), subscribes the now-verified email to the list, and sends
// the reader back to their comment on the story.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const c = sqliteVerifyComment(token);
  if (!c) {
    // Unknown/used token — send them home rather than showing a raw error.
    return NextResponse.redirect(`${siteUrl()}/?comment=expired`);
  }
  // Commenting subscribes you (idempotent — never clobbers an existing record).
  if (c.email) {
    const clean = c.email.trim().toLowerCase();
    try {
      sqliteMutate([{ createIfNotExists: {
        _id: subscriberIdForEmail(clean), _type: "subscriber",
        email: clean, status: "neutral", createdAt: new Date().toISOString(),
      } }]);
    } catch { /* subscribing is best-effort; the comment still publishes */ }
  }
  return NextResponse.redirect(`${siteUrl()}/stories/${c.slug}?comment=published#comments`);
}
