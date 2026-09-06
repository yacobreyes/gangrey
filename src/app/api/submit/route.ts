import { NextResponse } from "next/server";
import { Resend } from "resend";
import { sqliteAddSubmission } from "@/lib/storage/sqlite";
import { straightenQuotes } from "@/lib/straighten";
import { submissionEmailHtml, escapeHtml } from "@/lib/submissionEmail";
import { validateSubmission } from "@/lib/submissionValidation";
import { rateLimit } from "@/lib/rateLimit";
import { notify } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Throttle abusive posting: at most 5 submissions per IP per hour.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(ip, "submit", 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429 });
  }

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot: a hidden "website" field only bots fill. Feign success, store nothing.
  if ((body.website ?? "").trim()) return NextResponse.json({ ok: true });

  const name = straightenQuotes((body.name ?? "").trim());
  const email = (body.email ?? "").trim().toLowerCase();
  const title = straightenQuotes((body.title ?? "").trim());
  const category = (body.category ?? "").trim();
  const coverLetter = straightenQuotes((body.coverLetter ?? "").trim());
  const text = straightenQuotes((body.text ?? "").trim());

  // The API is the enforcement point (can't be bypassed by posting directly);
  // the form uses the same validateSubmission() for its live word counter, so
  // the two can never disagree on what's allowed.
  const result = validateSubmission({ name, email, title, category, coverLetter, text });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const { wordCount } = result;

  const record = { name, email, title, category, coverLetter, text, wordCount };
  try {
    sqliteAddSubmission(record);
  } catch (e) {
    console.log(`[submit] store failed: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Couldn't save your submission. Try again." }, { status: 500 });
  }

  // Tell the editors a story landed. Fire-and-forget by design: the submission
  // is already saved, and a push failure must never fail this request.
  notify({
    title: "New submission",
    body: `${title || "Untitled"} · ${category} · ${name}`,
    url: "/admin/imago/submissions",
    tag: "submission",
  });

  // Confirmation email to the writer (best-effort: a send failure must not lose
  // the submission, which is already stored above). Sent from the submissions
  // address so replies land in the submissions inbox, not the newsletter one.
  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  const from = process.env.SUBMISSIONS_FROM ?? "The Tampa Tribune <submissions@gangrey.org>";
  if (apiKey) {
    try {
      const resend = new Resend(apiKey);
      // Same layout as the accept/decline emails (see submissionActions):
      // a quiet 17px Re: line, then 17px body. The old oversized greeting
      // made this note look like a different publication's stationery.
      const html = submissionEmailHtml(
        `<p style="font-size:17px;line-height:1.6;color:#392a22 !important;margin:0 0 20px;">Re: "${escapeHtml(title)}" &middot; ${escapeHtml(category)}</p>
         <p style="font-size:17px;line-height:1.7;color:#000000 !important;margin:0;">Thanks, ${escapeHtml(name.split(" ")[0] || "")}. Your story is in. Every story is read by an editor, and we reply either way.</p>
         <p style="font-size:13px;line-height:1.6;color:#8a8a8c !important;margin:22px 0 0;">You don't need to reply to this note.</p>`,
        "Submission Received"
      );
      await resend.emails.send({ from, to: [email], subject: "We received your Tampa Tribune submission", html });
    } catch (e) {
      console.log(`[submit] confirmation email failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return NextResponse.json({ ok: true });
}
