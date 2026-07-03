import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getMemberByEmail } from "@/lib/membership";
import { makeLoginToken } from "@/lib/memberSession";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org").replace(/\/$/, "");

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // Always respond the same way whether or not the email is a member, so this
  // endpoint can't be used to enumerate who has a paid membership.
  const genericOk = NextResponse.json({ ok: true });

  const member = await getMemberByEmail(email);
  if (!member) return genericOk;

  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  const from = process.env.NEWSLETTER_FROM;
  if (!apiKey || !from) {
    // Email isn't configured — surface a real error to the admin/dev, not the
    // silent-success path, since nothing would arrive.
    return NextResponse.json({ error: "Login email isn't configured yet." }, { status: 500 });
  }

  const token = makeLoginToken(email);
  const link = `${SITE_URL}/api/member/callback?token=${encodeURIComponent(token)}`;
  const html = `
    <div style="font-family:Georgia,serif;max-width:440px;margin:0 auto;padding:24px;color:#000">
      <p style="font-size:18px;margin:0 0 16px">Sign in to your Gangrey membership</p>
      <p style="font-size:15px;line-height:1.5;color:#392a22;margin:0 0 24px">Click the button below to sign in. This link expires in 15 minutes.</p>
      <a href="${link}" style="display:inline-block;background:#490000;color:#fff;text-decoration:none;padding:12px 22px;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;border-radius:2px">Sign In</a>
      <p style="font-size:12px;color:#8a8a8c;margin:24px 0 0">If you didn't request this, you can ignore this email.</p>
    </div>`;

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to: [email], subject: "Sign in to Gangrey", html });
  } catch {
    // Don't leak send failures to the client beyond a generic message.
    return NextResponse.json({ error: "Couldn't send the login email. Try again." }, { status: 500 });
  }

  return genericOk;
}
