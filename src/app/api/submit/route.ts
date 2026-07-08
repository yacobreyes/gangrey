import { NextResponse } from "next/server";
import { Resend } from "resend";
import { isSqliteBackend, sqliteAddSubmission, type SubmissionRow } from "@/lib/storage/sqlite";
import { sanityMutate } from "@/lib/sanityWrite";
import { straightenQuotes } from "@/lib/straighten";
import { submissionEmailHtml, escapeHtml } from "@/lib/submissionEmail";
import { validateSubmission } from "@/lib/submissionValidation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = straightenQuotes((body.name ?? "").trim());
  const email = (body.email ?? "").trim().toLowerCase();
  const title = straightenQuotes((body.title ?? "").trim());
  const category = (body.category ?? "").trim();
  const coverLetter = straightenQuotes((body.coverLetter ?? "").trim());
  const text = straightenQuotes((body.text ?? "").trim());

  // The API is the enforcement point (can't be bypassed by posting directly);
  // the form uses the same validateSubmission() for its live word counter, so
  // the two can never disagree on what's allowed.
  const result = validateSubmission({ name, email, title, category, text });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const { wordCount } = result;

  const record = { name, email, title, category, coverLetter, text, wordCount };
  try {
    if (isSqliteBackend()) {
      sqliteAddSubmission(record);
    } else {
      const id = `submission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const doc: Omit<SubmissionRow, "_id"> & { _id: string; _type: string } = {
        _id: id, _type: "submission", status: "new", _createdAt: new Date().toISOString(), ...record,
      };
      await sanityMutate([{ create: doc }]);
    }
  } catch (e) {
    console.log(`[submit] store failed: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Couldn't save your submission. Try again." }, { status: 500 });
  }

  // Confirmation email to the writer (best-effort: a send failure must not lose
  // the submission, which is already stored above). Sent from the submissions
  // address so replies land in the submissions inbox, not the newsletter one.
  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  const from = process.env.SUBMISSIONS_FROM ?? "Gangrey <submissions@gangrey.org>";
  if (apiKey) {
    try {
      const resend = new Resend(apiKey);
      const html = submissionEmailHtml(
        `<p style="font-size:21px;line-height:1.35;margin:0 0 18px;color:#000000 !important;">Thanks, ${escapeHtml(name.split(" ")[0] || "")}. Your story is in.</p>
         <p style="font-size:16px;line-height:1.7;color:#392a22 !important;margin:0 0 8px;">We received <strong>"${escapeHtml(title)}"</strong> &middot; ${escapeHtml(category)}. Every story is read by an editor, and we reply either way.</p>
         <p style="font-size:13px;line-height:1.6;color:#8a8a8c !important;margin:22px 0 0;">You don't need to reply to this note.</p>`,
        "Submission Received"
      );
      await resend.emails.send({ from, to: [email], subject: "We received your Gangrey submission", html });
    } catch (e) {
      console.log(`[submit] confirmation email failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return NextResponse.json({ ok: true });
}
