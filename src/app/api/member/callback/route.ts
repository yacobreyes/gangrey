import { NextResponse } from "next/server";
import { verifyLoginToken, setMemberSession } from "@/lib/memberSession";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org").replace(/\/$/, "");

// Magic-link landing: verify the emailed token, set the session cookie, and
// bounce to the account page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const email = token ? verifyLoginToken(token) : null;

  if (!email) {
    return NextResponse.redirect(`${SITE_URL}/account?error=expired`);
  }

  await setMemberSession(email);
  return NextResponse.redirect(`${SITE_URL}/account`);
}
