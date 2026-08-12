import { NextResponse, type NextRequest } from "next/server";
import { METER_COOKIE } from "@/lib/meter";

// Two jobs:
// 1. Canonical host: 301 gangrey.org -> www.gangrey.org. Behind the reverse
//    proxy the browser's real host arrives as x-forwarded-host (Host is the
//    internal container), so a next.config `has: host` rule can miss it —
//    check the forwarded host here so the bare domain never serves a
//    duplicate to Google.
//
//    NOTE for the server: if the Caddyfile still carries the old block that
//    redirects www -> gangrey.org, the two redirects will loop. Caddy must
//    serve BOTH hostnames to the app (or redirect apex -> www itself); see
//    SELFHOST.md "www subdomain".
// 2. Ensure every story-page visitor carries a stable, cookieless meter id so
//    the metered paywall can count free reads (middleware can write cookies; a
//    Server Component render cannot).
export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  if (host === "gangrey.org") {
    return NextResponse.redirect(`https://www.gangrey.org${req.nextUrl.pathname}${req.nextUrl.search}`, 301);
  }

  const res = NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/stories/") && !req.cookies.get(METER_COOKIE)) {
    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    res.cookies.set(METER_COOKIE, id, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 400, path: "/" });
  }
  return res;
}

// Run on everything except Next's static assets, so the www redirect applies
// site-wide (the meter cookie still only sets on /stories, guarded above).
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|woff2?)$).*)"] };
