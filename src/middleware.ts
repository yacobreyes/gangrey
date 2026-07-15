import { NextResponse, type NextRequest } from "next/server";
import { METER_COOKIE } from "@/lib/meter";

// Ensure every visitor to a story page carries a stable, cookieless meter id,
// so the metered paywall can count free reads per month. Set here (middleware
// can write cookies; a Server Component render cannot).
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get(METER_COOKIE)) {
    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    res.cookies.set(METER_COOKIE, id, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 400, path: "/" });
  }
  return res;
}

export const config = { matcher: ["/stories/:path*"] };
