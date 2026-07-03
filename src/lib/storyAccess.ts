import type { SanityPost } from "./sanity";
import type { PortableTextBlock } from "@portabletext/types";

// A story is members-only if it's an Archive post (the whole archive is a
// paid benefit) or it's been explicitly marked "paid" in the editor.
export function storyRequiresMembership(post: Pick<SanityPost, "section" | "access">): boolean {
  if (post.section === "Archive") return true;
  return post.access === "paid";
}

// For the paywall preview: keep the first N text paragraphs, drop the rest,
// so non-members see a genuine excerpt (not just the headline) before the gate.
export function previewBody(body: PortableTextBlock[], paragraphs = 2): PortableTextBlock[] {
  const out: PortableTextBlock[] = [];
  let count = 0;
  for (const block of body) {
    out.push(block);
    if (block._type === "block" && (block.style === "normal" || !block.style)) {
      count++;
      if (count >= paragraphs) break;
    }
  }
  return out;
}
