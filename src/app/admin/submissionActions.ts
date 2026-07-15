"use server";

import { Resend } from "resend";
import { requireAuth } from "@/lib/adminAuth";
import {
  sqliteAllSubmissions, sqliteGetSubmission,
  sqliteUpdateSubmission, sqliteDeleteSubmission,
  type SubmissionRow, type SubmissionStatus,
} from "@/lib/storage/sqlite";
import { submissionEmailHtml, escapeHtml } from "@/lib/submissionEmail";
import { createPostFromNewsletterCard } from "./actions";

export async function getSubmissions(): Promise<SubmissionRow[]> {
  await requireAuth();
  return sqliteAllSubmissions();
}

async function getOne(id: string): Promise<SubmissionRow | null> {
  return sqliteGetSubmission(id);
}

async function patch(id: string, fields: Partial<SubmissionRow>): Promise<void> {
  sqliteUpdateSubmission(id, fields);
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
  // The whole body is wrapped so ANY failure — auth, a bad submission id, the
  // Resend call, or the status patch after — returns a real message instead of
  // throwing past this function, where the client only sees a generic
  // "Something went wrong." Errors are also logged server-side (check
  // `docker compose logs` / the systemd journal) since Resend failures often
  // carry detail (e.g. an unverified sender domain) worth seeing in full.
  try {
    await requireAuth();
    const sub = await getOne(id);
    if (!sub) return { ok: false, error: "Submission not found." };

    const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
    // Replies come from (and reply-to) the submissions address so the whole
    // conversation stays in that inbox.
    const from = process.env.SUBMISSIONS_FROM ?? "Gangrey <submissions@gangrey.org>";
    if (!apiKey) return { ok: false, error: "Email isn't configured (GANGREY_RESEND_KEY / RESEND_API_KEY missing)." };

    const heading = decision === "accepted" ? "Good news from Gangrey" : "About your Gangrey submission";
    const body = (message || "").trim();
    if (!body) return { ok: false, error: "Write a message to the author before sending." };

    const html = submissionEmailHtml(
      `<p style="font-size:17px;line-height:1.6;color:#392a22 !important;margin:0 0 20px;">Re: "${escapeHtml(sub.title)}"</p>
       <p style="font-size:17px;line-height:1.7;color:#000000 !important;margin:0;white-space:pre-line;">${escapeHtml(body)}</p>`,
      decision === "accepted" ? "You're In" : "About Your Submission"
    );

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: [sub.email],
      replyTo: from,
      subject: `${heading}: "${sub.title}"`,
      html,
    });
    if (error) {
      console.error(`[respondToSubmission] Resend error for ${sub.email}:`, error);
      return { ok: false, error: error.message || "Resend rejected the send." };
    }

    await patch(id, { status: decision, respondedAt: new Date().toISOString() });
    return { ok: true };
  } catch (e) {
    console.error("[respondToSubmission] failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't send the reply." };
  }
}

// Spin a submission into a publishable story draft in Imago (same machinery the
// newsletter uses to turn a card into a post). Converts the plain pasted text
// into portable-text blocks, maps the category to a section, and prefills the
// byline with the author's name so the editor can open and polish it.
const CATEGORY_SECTION: Record<string, string> = {
  "Essay": "Essays",
  "Reported Narrative": "Narratives",
  "Micro-Memoir": "Micro-Memoir",
};

function textToBlocks(text: string): unknown[] {
  const paras = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map(p => p.replace(/\n/g, " ").trim()).filter(Boolean);
  return (paras.length ? paras : [text.trim()]).map(p => ({
    _type: "block",
    _key: `b${Math.random().toString(36).slice(2, 9)}`,
    style: "normal",
    markDefs: [],
    children: [{ _type: "span", _key: `s${Math.random().toString(36).slice(2, 9)}`, text: p, marks: [] }],
  }));
}

export async function createStoryFromSubmission(id: string): Promise<{ ok: boolean; slug?: string; error?: string }> {
  await requireAuth();
  const sub = await getFull(id);
  if (!sub) return { ok: false, error: "Submission not found." };
  try {
    const { slug } = await createPostFromNewsletterCard({
      headline: sub.title,
      body: textToBlocks(sub.text || ""),
      byline: sub.name,
      section: CATEGORY_SECTION[sub.category] ?? "",
    });
    return { ok: true, slug };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't create the draft." };
  }
}

async function getFull(id: string): Promise<SubmissionRow | null> {
  return sqliteGetSubmission(id);
}

export async function deleteSubmission(id: string): Promise<{ ok: boolean }> {
  await requireAuth();
  sqliteDeleteSubmission(id);
  return { ok: true };
}

