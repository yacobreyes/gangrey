import { NextResponse } from "next/server";
import { Resend } from "resend";
import { isSqliteBackend, sqliteAddSubmission, type SubmissionRow } from "@/lib/storage/sqlite";
import { sanityMutate } from "@/lib/sanityWrite";
import { straightenQuotes } from "@/lib/straighten";

export const dynamic = "force-dynamic";

// Per-category hard word limits (enforced here so the API can't be bypassed by
// posting directly, and mirrored in the form + guidelines).
const WORD_LIMITS: Record<string, number> = {
  "Essay": 1000,
  "Reported Narrative": 400,
  "Micro-Memoir": 100,
};
const CATEGORIES = Object.keys(WORD_LIMITS);

function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

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

  if (!name) return NextResponse.json({ error: "Add your name." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Give your piece a title." }, { status: 400 });
  if (!CATEGORIES.includes(category)) return NextResponse.json({ error: "Choose a category." }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Paste your piece before submitting." }, { status: 400 });

  const wordCount = countWords(text);
  const limit = WORD_LIMITS[category];
  if (wordCount > limit) {
    return NextResponse.json({ error: `${category}s must be ${limit.toLocaleString()} words or fewer. Yours is ${wordCount.toLocaleString()}.` }, { status: 400 });
  }

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

  // Confirmation email to the writer (best-effort — a send failure must not lose
  // the submission, which is already stored above). Sent from the submissions
  // address so replies land in the submissions inbox, not the newsletter one.
  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  const from = process.env.SUBMISSIONS_FROM ?? "Gangrey <submissions@gangrey.org>";
  if (apiKey) {
    try {
      const resend = new Resend(apiKey);
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:460px;margin:0 auto;padding:28px 24px;color:#000000;">
    <p style="font-size:18px;margin:0 0 16px;">Thanks for submitting to Gangrey.</p>
    <p style="font-size:15px;line-height:1.6;color:#392a22;margin:0 0 8px;">We received <strong>&ldquo;${title.replace(/</g, "&lt;")}&rdquo;</strong> (${category}). Every piece is read by an editor. If it's a fit, we'll be in touch; if it isn't, we'll still let you know.</p>
    <p style="font-size:13px;line-height:1.6;color:#8a8a8c;margin:20px 0 0;">You don't need to reply to this note. Thanks for trusting us with your work.</p>
    <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#490000;margin:24px 0 0;">Gangrey</p>
  </div>
</body></html>`;
      await resend.emails.send({ from, to: [email], subject: "We received your Gangrey submission", html });
    } catch (e) {
      console.log(`[submit] confirmation email failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return NextResponse.json({ ok: true });
}
