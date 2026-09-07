import { Resend } from "resend";
import { submissionEmailHtml, escapeHtml } from "./submissionEmail";
import { sqliteAllPublishedPostsLight } from "./storage/sqlite";
import { straightenQuotes } from "./straighten";
import { tagEmailLinks } from "./emailUtm";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org";

// Sent once, when a NEW subscriber signs up. Points them at what's on the
// homepage right now and sets expectations: a monthly classics newsletter,
// and issues when they launch. Best-effort by design; a send failure must
// never fail the signup that triggered it.
export async function sendWelcomeEmail(to: string): Promise<void> {
  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  const from = process.env.NEWSLETTER_FROM;
  if (!apiKey || !from) return; // email not configured: signup still succeeds

  // The homepage's own picks: the pinned hero first, then pinned Top Stories,
  // then the newest published work, archive excluded. Three links.
  const posts = sqliteAllPublishedPostsLight().filter(p => p.section !== "Archive");
  const hero = posts.find(p => p.pinnedHero);
  const rest = posts.filter(p => p !== hero);
  const picks = [hero, ...rest.filter(p => p.pinnedTop), ...rest.filter(p => !p.pinnedTop)]
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .slice(0, 3);

  const storyRows = picks.map(p => `
    <p style="font-size:17px;line-height:1.5;margin:0 0 14px;">
      <a href="${SITE_URL}/stories/${p.slug}" style="color:#000000 !important;font-weight:bold;text-decoration:underline;">${escapeHtml(straightenQuotes(p.headline))}</a>
      ${p.byline ? `<span style="color:#392a22 !important;font-size:14px;"> &middot; ${escapeHtml(straightenQuotes(p.byline))}</span>` : ""}
    </p>`).join("");

  // Tagged so story clicks from this email attribute to it in Analytics
  // instead of "Direct" (mail clients send no referrer).
  const html = tagEmailLinks(submissionEmailHtml(
    `<p style="font-size:17px;line-height:1.7;color:#000000 !important;margin:0 0 20px;">
       Thanks for signing up. The Sunland Tribune publishes true stories for the time you have. Start with what's on our front page:
     </p>
     ${storyRows}
     <p style="font-size:17px;line-height:1.7;color:#000000 !important;margin:20px 0 0;">
       From here you'll get our monthly Sunland Tribune Classics newsletter, and our issues when they launch.
     </p>
     <p style="font-size:13px;line-height:1.6;color:#8a8a8c !important;margin:22px 0 0;">
       Not you, or changed your mind? <a href="${SITE_URL}/unsubscribe?email=${encodeURIComponent(to)}" style="color:#8a8a8c !important;">Unsubscribe</a>.
     </p>`,
    "Welcome to The Sunland Tribune"
  ), "welcome-email");

  const resend = new Resend(apiKey);
  // The SDK resolves with { error } instead of throwing; surface it so the
  // caller's catch can log the failure rather than swallowing it.
  const { error } = await resend.emails.send({ from, to: [to], subject: "Welcome to The Sunland Tribune", html });
  if (error) throw new Error(error.message || "Resend rejected the welcome email");
}
