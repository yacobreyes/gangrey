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
import { submissionEmailHtml, escapeHtml } from "@/lib/submissionEmail";

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
  // Replies come from (and reply-to) the submissions address so the whole
  // conversation stays in that inbox.
  const from = process.env.SUBMISSIONS_FROM ?? "Gangrey <submissions@gangrey.org>";
  if (!apiKey) return { ok: false, error: "Email isn't configured, so a reply can't be sent." };

  const heading = decision === "accepted" ? "Good news from Gangrey" : "About your Gangrey submission";
  const body = (message || "").trim();
  if (!body) return { ok: false, error: "Write a message to the author before sending." };

  const html = submissionEmailHtml(`<p style="font-size:16px;line-height:1.7;color:#000000 !important;margin:0 0 8px;white-space:pre-line;">${escapeHtml(body)}</p>`);

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: [sub.email],
      replyTo: from,
      subject: `${heading}: "${sub.title}"`,
      html,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't send the reply." };
  }

  await patch(id, { status: decision, respondedAt: new Date().toISOString() });
  return { ok: true };
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
  const { createPostFromNewsletterCard } = await import("./actions");
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
  if (isSqliteBackend()) return sqliteGetSubmission(id);
  const r = await client.fetch(
    `*[_id == $id][0]{ "_id": _id, name, email, title, category, coverLetter, text, wordCount, status, respondedAt, _createdAt }`,
    { id }, { cache: "no-store" }
  );
  return (r ?? null) as SubmissionRow | null;
}

export async function deleteSubmission(id: string): Promise<{ ok: boolean }> {
  await requireAuth();
  if (isSqliteBackend()) sqliteDeleteSubmission(id);
  else await sanityMutate([{ delete: { id } }]);
  return { ok: true };
}

