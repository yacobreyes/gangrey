// Single source of truth for submission-portal category word limits — shared
// between the client form (src/app/submit/SubmitForm.tsx, live word counter)
// and the API route (src/app/api/submit/route.ts, the actual enforcement).
// Previously these were two hand-copied objects; if one changed and the other
// didn't, the form would show one limit while the server enforced another.
export const WORD_LIMITS: Record<string, number> = {
  "Essay": 1000,
  "Reported Narrative": 400,
  "Micro-Memoir": 100,
};

export const SUBMISSION_CATEGORIES = Object.keys(WORD_LIMITS);

export function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

export type SubmissionInput = {
  name: string;
  email: string;
  title: string;
  category: string;
  coverLetter: string;
  text: string;
};

export type SubmissionValidationResult =
  | { ok: true; wordCount: number }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validates a submission and returns either the computed word count or the
// first failing error message, in the same field order the form presents
// them — so the server and client always agree on what's wrong.
export function validateSubmission(input: SubmissionInput): SubmissionValidationResult {
  if (!input.name.trim()) return { ok: false, error: "Add your name." };
  if (!EMAIL_RE.test(input.email)) return { ok: false, error: "Enter a valid email address." };
  if (!input.title.trim()) return { ok: false, error: "Give your story a title." };
  if (!SUBMISSION_CATEGORIES.includes(input.category)) return { ok: false, error: "Choose a category." };
  if (!input.coverLetter.trim()) return { ok: false, error: "Add a cover letter." };
  if (!input.text.trim()) return { ok: false, error: "Paste your story before submitting." };

  const wordCount = countWords(input.text);
  const limit = WORD_LIMITS[input.category];
  if (wordCount > limit) {
    return { ok: false, error: `${input.category}s must be ${limit.toLocaleString()} words or fewer. Yours is ${wordCount.toLocaleString()}.` };
  }
  return { ok: true, wordCount };
}
