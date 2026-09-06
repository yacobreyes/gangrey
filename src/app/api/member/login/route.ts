import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getMemberByEmail } from "@/lib/membership";
import { makeLoginToken } from "@/lib/memberSession";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org").replace(/\/$/, "");

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
  if (!member) {
    // Server-log only (Vercel function logs) — the client response stays
    // identical to the sent case so membership can't be enumerated.
    console.log(`[member-login] no member record for ${email}; skipping send`);
    return genericOk;
  }

  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  // Login mail comes from the members address (newsletters come from
  // NEWSLETTER_FROM, submissions from submissions@) — override with
  // MEMBERS_FROM if it ever needs to change.
  const from = process.env.MEMBERS_FROM ?? "The Tampa Tribune <members@gangrey.org>";
  if (!apiKey) {
    // Email isn't configured — surface a real error to the admin/dev, not the
    // silent-success path, since nothing would arrive.
    console.log(`[member-login] missing GANGREY_RESEND_KEY/RESEND_API_KEY`);
    return NextResponse.json({ error: "Login email isn't configured yet." }, { status: 500 });
  }

  const token = makeLoginToken(email);
  const link = `${SITE_URL}/api/member/callback?token=${encodeURIComponent(token)}`;
  // Full HTML doc with a forced light color scheme + bgcolor table button so
  // dark-mode mail clients (Apple Mail especially) can't invert the crimson
  // button into pink with dark text.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <div style="font-family:Georgia,serif;max-width:440px;margin:0 auto;padding:24px;color:#000000;background-color:#ffffff;">
    <p style="font-size:18px;margin:0 0 16px;color:#000000;">Sign in to your Tampa Tribune membership</p>
    <p style="font-size:15px;line-height:1.5;color:#392a22;margin:0 0 24px;">Click the button below to sign in. This link expires in 15 minutes.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td bgcolor="#490000" style="background-color:#490000 !important;border-radius:2px;">
          <a href="${link}" style="display:inline-block;background-color:#490000 !important;color:#ffffff !important;text-decoration:none;padding:12px 22px;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;border-radius:2px;">
            <span style="color:#ffffff !important;">Sign In</span>
          </a>
        </td>
      </tr>
    </table>
    <p style="font-size:12px;color:#8a8a8c;margin:24px 0 0;">If you didn't request this, you can ignore this email.</p>
  </div>
</body>
</html>`;

  try {
    const resend = new Resend(apiKey);
    // Resend reports API failures via the returned `error`, not by throwing —
    // ignoring it means "success" with no email ever arriving.
    const { error } = await resend.emails.send({ from, to: [email], subject: "Sign in to The Tampa Tribune", html });
    if (error) {
      console.log(`[member-login] resend error for ${email}: ${error.message}`);
      return NextResponse.json({ error: "Couldn't send the login email. Try again." }, { status: 500 });
    }
  } catch (err) {
    console.log(`[member-login] send threw for ${email}: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "Couldn't send the login email. Try again." }, { status: 500 });
  }

  console.log(`[member-login] sent login link to ${email}`);
  return genericOk;
}
