import type { SanityPost } from "./sanity";
import type { PortableTextBlock } from "@portabletext/types";

// A story is members-only if it's an Archive post (the whole archive is a
// paid benefit) or it's been explicitly marked "paid" in the editor.
export function storyRequiresMembership(post: Pick<SanityPost, "section" | "access">): boolean {
  if (post.section === "Archive") return true;
  return post.access === "paid";
}

// For the paywall preview: keep roughly the first couple of paragraphs of
// TEXT, so non-members see a genuine excerpt (not just the headline) before
// the gate. Capped by characters, not block count — some archive imports parse
// as one giant block, and a block-count cap would leak the whole story.
export function previewBody(body: PortableTextBlock[], maxChars = 700): PortableTextBlock[] {
  const out: PortableTextBlock[] = [];
  let used = 0;
  for (const block of body) {
    if (block._type !== "block") { out.push(block); continue; }
    const children = (block.children ?? []) as { _type?: string; text?: string }[];
    const blockLen = children.reduce((n, c) => n + (c.text?.length ?? 0), 0);
    if (used + blockLen <= maxChars) {
      out.push(block);
      used += blockLen;
      if (used >= maxChars) break;
      continue;
    }
    // This block crosses the cap — truncate its text mid-block at a word break.
    const remaining = maxChars - used;
    const truncated: typeof children = [];
    let taken = 0;
    for (const c of children) {
      const t = c.text ?? "";
      if (taken + t.length <= remaining) { truncated.push(c); taken += t.length; continue; }
      const slice = t.slice(0, Math.max(0, remaining - taken));
      const cut = slice.lastIndexOf(" ") > 40 ? slice.slice(0, slice.lastIndexOf(" ")) : slice;
      truncated.push({ ...c, text: cut + "…" });
      break;
    }
    out.push({ ...block, children: truncated } as PortableTextBlock);
    break;
  }
  return out;
}
