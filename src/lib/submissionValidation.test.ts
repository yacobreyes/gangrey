import { describe, it, expect } from "vitest";
import { validateSubmission, countWords, WORD_LIMITS } from "./submissionValidation";

function validInput(overrides: Partial<Parameters<typeof validateSubmission>[0]> = {}) {
  return {
    name: "Yacob Reyes",
    email: "yacob@gangrey.org",
    title: "The Boy with the Toy Gun",
    category: "Essay",
    coverLetter: "A short note about me and the story.",
    text: "word ".repeat(10).trim(),
    ...overrides,
  };
}

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("one two three")).toBe(3);
  });
  it("treats an empty/whitespace-only string as zero words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
  it("collapses multiple spaces/newlines between words", () => {
    expect(countWords("one\n\n  two   three")).toBe(3);
  });
});

describe("validateSubmission", () => {
  it("accepts a valid submission and returns its word count", () => {
    const result = validateSubmission(validInput({ text: "one two three" }));
    expect(result).toEqual({ ok: true, wordCount: 3 });
  });

  it("rejects a missing name", () => {
    const result = validateSubmission(validInput({ name: "" }));
    expect(result).toEqual({ ok: false, error: "Add your name." });
  });

  it("rejects an invalid email", () => {
    const result = validateSubmission(validInput({ email: "not-an-email" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a missing title", () => {
    const result = validateSubmission(validInput({ title: "  " }));
    expect(result).toEqual({ ok: false, error: "Give your story a title." });
  });

  it("rejects an unrecognized category", () => {
    const result = validateSubmission(validInput({ category: "Poem" }));
    expect(result).toEqual({ ok: false, error: "Choose a category." });
  });

  it("rejects empty story text", () => {
    const result = validateSubmission(validInput({ text: "  " }));
    expect(result).toEqual({ ok: false, error: "Paste your story before submitting." });
  });

  // The exact limits that keep getting quoted around this project — pin them
  // down so a future "let's bump the essay limit" change is a deliberate,
  // visible edit to WORD_LIMITS, not an accidental one-sided drift between
  // the form and the API.
  it("enforces the Essay limit at exactly 1000 words", () => {
    expect(WORD_LIMITS["Essay"]).toBe(1000);
    const atLimit = validateSubmission(validInput({ category: "Essay", text: "w ".repeat(1000).trim() }));
    expect(atLimit.ok).toBe(true);
    const overLimit = validateSubmission(validInput({ category: "Essay", text: "w ".repeat(1001).trim() }));
    expect(overLimit).toEqual({ ok: false, error: "Essays must be 1,000 words or fewer. Yours is 1,001." });
  });

  it("enforces the Reported Narrative limit at 400 words", () => {
    expect(WORD_LIMITS["Reported Narrative"]).toBe(400);
    const overLimit = validateSubmission(validInput({ category: "Reported Narrative", text: "w ".repeat(401).trim() }));
    expect(overLimit.ok).toBe(false);
  });

  it("enforces the Micro-Memoir limit at 100 words", () => {
    expect(WORD_LIMITS["Micro-Memoir"]).toBe(100);
    const overLimit = validateSubmission(validInput({ category: "Micro-Memoir", text: "w ".repeat(101).trim() }));
    expect(overLimit.ok).toBe(false);
  });

  it("checks fields in the same order the form presents them (name before email before title...)", () => {
    // Everything blank — should fail on name first, not email.
    const result = validateSubmission({ name: "", email: "", title: "", category: "", coverLetter: "", text: "" });
    expect(result).toEqual({ ok: false, error: "Add your name." });
  });
});
