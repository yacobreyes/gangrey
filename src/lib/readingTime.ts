import type { PortableTextBlock } from "@portabletext/types";
import type { Post } from "./content";

// Assumed reading speed, in words per minute.
const WORDS_PER_MINUTE = 265;

export function plainTextFromBlocks(blocks?: PortableTextBlock[]): string {
  return (blocks ?? [])
    .filter(b => (b as { _type?: string })._type === "block")
    .map(b => ((b as { children?: { text?: string }[] }).children ?? []).map(c => c.text ?? "").join(""))
    .join(" ");
}

export function readingTimeFromText(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length || 1;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

// Effective reading time for a post: the manually-set value when present,
// otherwise an estimate from the body's word count.
export function postReadingTime(post: Pick<Post, "body" | "readingTime">): number {
  return post.readingTime ?? readingTimeFromText(plainTextFromBlocks(post.body));
}
