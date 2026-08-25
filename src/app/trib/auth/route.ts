import { NextRequest, NextResponse } from "next/server";
import { tribPassword, tribToken, TRIB_COOKIE } from "@/lib/trib";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Login (POST pw) and logout (?logout=1) for the /trib tool. Sets an
// HMAC-signed cookie; the page itself checks it. 404s when no password is
// configured, same as the page, so the route reveals nothing.
export async function POST(req: NextRequest) {
  if (!tribPassword()) return new NextResponse("Not found", { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(ip, "trib-login", 10, 10 * 60 * 1000)) {
    return new NextResponse("Too many attempts. Try again later.", { status: 429 });
  }
  const form = await req.formData().catch(() => null);
  const pw = String(form?.get("pw") ?? "");
  const res = NextResponse.redirect(new URL(pw === tribPassword() ? "/trib" : "/trib?bad=1", req.nextUrl.origin), 303);
  if (pw === tribPassword()) {
    res.cookies.set(TRIB_COOKIE, tribToken()!, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/trib", maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}

export async function GET(req: NextRequest) {
  if (!tribPassword()) return new NextResponse("Not found", { status: 404 });
  const res = NextResponse.redirect(new URL("/trib", req.nextUrl.origin), 303);
  if (req.nextUrl.searchParams.has("logout")) {
    res.cookies.set(TRIB_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: true, path: "/trib", maxAge: 0 });
  }
  return res;
}
