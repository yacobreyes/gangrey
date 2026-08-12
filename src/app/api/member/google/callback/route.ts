import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getMemberByEmail } from "@/lib/membership";
import { setMemberSession } from "@/lib/memberSession";

export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org").replace(/\/$/, "");
const REDIRECT_URI = `${SITE_URL}/api/member/google/callback`;

// Where Google sends the visitor back. Verify the result, then: if the email
// belongs to an active member, sign them in; otherwise send them to the account
// page with a prompt to subscribe (only members can sign in).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const savedState = store.get("gg_oauth_state")?.value;
  store.delete("gg_oauth_state");
  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${SITE_URL}/account?error=google`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return NextResponse.redirect(`${SITE_URL}/account?error=google`);

  // Exchange the code for tokens directly with Google (server to server, TLS,
  // authenticated with the client secret) so the returned id_token is trusted
  // without a separate signature check.
  let email = "", verified = false;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
      }),
    });
    const data = await res.json() as { id_token?: string };
    if (data.id_token) {
      const payload = JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64url").toString()) as { email?: string; email_verified?: boolean | string };
      email = (payload.email ?? "").trim().toLowerCase();
      verified = payload.email_verified === true || payload.email_verified === "true";
    }
  } catch { /* fall through to the generic error */ }

  if (!email || !verified) return NextResponse.redirect(`${SITE_URL}/account?error=google`);

  const member = await getMemberByEmail(email);
  const active = !!member && (member.status === "active" || member.status === "trialing");
  if (!active) {
    // Only members can sign in. Send them to the account page, which shows a
    // subscribe prompt for this case.
    return NextResponse.redirect(`${SITE_URL}/account?members_only=1`);
  }

  await setMemberSession(email);
  return NextResponse.redirect(`${SITE_URL}/account`);
}
