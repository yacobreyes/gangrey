import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org").replace(/\/$/, "");
const REDIRECT_URI = `${SITE_URL}/api/member/google/callback`;

// Kick off "Continue with Google" for reader memberships. Sends the visitor to
// Google's consent screen; the callback verifies the result. Independent of the
// admin NextAuth/Google flow, and it only ever sets the reader session cookie.
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${SITE_URL}/account?error=google`);

  const state = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/-/g, "");
  const store = await cookies();
  store.set("gg_oauth_state", state, {
    httpOnly: true, secure: process.env.NODE_ENV !== "development",
    sameSite: "lax", path: "/", maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
