import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// Lightweight stateless sessions for reader memberships — independent of the
// admin NextAuth/Google flow. A magic-link token and the session cookie are
// both HMAC-signed compact tokens (payload.signature, base64url) using
// NEXTAUTH_SECRET. No DB of tokens needed; expiry is encoded in the payload.

const SECRET = process.env.NEXTAUTH_SECRET ?? "";
export const MEMBER_COOKIE = "gg_member";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const LINK_TTL_SECONDS = 60 * 15; // 15 minutes

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function makeToken(data: Record<string, unknown>, ttlSeconds: number): string {
  const body = { ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payload = b64url(JSON.stringify(body));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string | undefined | null): Record<string, unknown> | null {
  if (!token || !SECRET) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    if (typeof body.exp === "number" && body.exp * 1000 < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}

// ---- Magic-link token (emailed) ----
export function makeLoginToken(email: string): string {
  return makeToken({ email: email.trim().toLowerCase(), kind: "login" }, LINK_TTL_SECONDS);
}

export function verifyLoginToken(token: string): string | null {
  const body = verifyToken(token);
  if (!body || body.kind !== "login" || typeof body.email !== "string") return null;
  return body.email;
}

// ---- Session cookie ----
export async function setMemberSession(email: string): Promise<void> {
  const token = makeToken({ email: email.trim().toLowerCase(), kind: "session" }, SESSION_TTL_SECONDS);
  const store = await cookies();
  store.set(MEMBER_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearMemberSession(): Promise<void> {
  const store = await cookies();
  store.delete(MEMBER_COOKIE);
}

// The email of the currently-signed-in reader, or null. This proves identity;
// membership status is looked up separately from Sanity so cancellations take
// effect immediately regardless of the cookie's 30-day life.
export async function getSessionEmail(): Promise<string | null> {
  const store = await cookies();
  const body = verifyToken(store.get(MEMBER_COOKIE)?.value);
  if (!body || body.kind !== "session" || typeof body.email !== "string") return null;
  return body.email;
}
