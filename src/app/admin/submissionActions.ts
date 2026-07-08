"use server";

import { Resend } from "resend";
import { requireAuth } from "@/lib/adminAuth";
import { client } from "@/lib/sanity";
import { sanityMutate } from "@/lib/sanityWrite";
import {
  isSqliteBackend, sqliteAllSubmissions, sqliteGetSubmission,
  sqliteUpdateSubmission, sqliteDeleteSubmission,
  type SubmissionRow, type SubmissionStatus,
} from "@/lib/storage/sqlite";

export async function getSubmissions(): Promise<SubmissionRow[]> {
  await requireAuth();
  if (isSqliteBackend()) return sqliteAllSubmissions();
  const rows = await client.fetch(
    `*[_type == "submission"] | order(_createdAt desc){ "_id": _id, name, email, title, category, coverLetter, text, wordCount, status, respondedAt, _createdAt }`,
    {},
    { cache: "no-store" }
  );
  return (rows ?? []) as SubmissionRow[];
}

async function getOne(id: string): Promise<SubmissionRow | null> {
  if (isSqliteBackend()) return sqliteGetSubmission(id);
  const r = await client.fetch(`*[_id == $id][0]{ "_id": _id, name, email, title, category, status }`, { id }, { cache: "no-store" });
  return (r ?? null) as SubmissionRow | null;
}

async function patch(id: string, fields: Partial<SubmissionRow>): Promise<void> {
  if (isSqliteBackend()) sqliteUpdateSubmission(id, fields);
  else await sanityMutate([{ patch: { id, set: fields } }]);
}

// Move a submission through the review workflow without notifying the writer
// (new ↔ reading). Accept/decline go through respondToSubmission so a reply
// email is always sent with the decision.
export async function setSubmissionStatus(id: string, status: Extract<SubmissionStatus, "new" | "reading">): Promise<{ ok: boolean }> {
  await requireAuth();
  await patch(id, { status });
  return { ok: true };
}

export async function respondToSubmission(
  id: string,
  decision: "accepted" | "declined",
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const sub = await getOne(id);
  if (!sub) return { ok: false, error: "Submission not found." };

  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  const from = process.env.NEWSLETTER_FROM;
  if (!apiKey || !from) return { ok: false, error: "Email isn't configured, so a reply can't be sent." };

  const heading = decision === "accepted" ? "Good news from Gangrey" : "About your Gangrey submission";
  const body = (message || "").trim();
  if (!body) return { ok: false, error: "Write a message to the author before sending." };

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:460px;margin:0 auto;padding:28px 24px;color:#000000;">
    <p style="font-size:15px;line-height:1.6;color:#000000;margin:0 0 8px;white-space:pre-line;">${escapeHtml(body)}</p>
    <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#490000;margin:24px 0 0;">Gangrey</p>
  </div>
</body></html>`;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: [sub.email],
      replyTo: from,
      subject: `${heading}: “${sub.title}”`,
      html,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't send the reply." };
  }

  await patch(id, { status: decision, respondedAt: new Date().toISOString() });
  return { ok: true };
}

export async function deleteSubmission(id: string): Promise<{ ok: boolean }> {
  await requireAuth();
  if (isSqliteBackend()) sqliteDeleteSubmission(id);
  else await sanityMutate([{ delete: { id } }]);
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
