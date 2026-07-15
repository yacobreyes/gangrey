import type { JSONContent } from "@tiptap/react";
import type { PortableTextBlock } from "@portabletext/types";

type PTSpan = { _type: "span"; _key: string; text: string; marks: string[] };
type PTMarkDef = { _key: string; _type: string; href?: string };
type PTBlock = PortableTextBlock & { markDefs: PTMarkDef[]; children: PTSpan[] };

// The recovered Archive was imported with blank paragraph blocks between real
// paragraphs, which render as tall empty gaps. Drop text blocks that carry no
// content (leaving images, lists, and headings untouched) so those posts read
// with normal paragraph spacing. Scoped to Archive at the call sites.
export function stripEmptyBlocks(blocks: PortableTextBlock[]): PortableTextBlock[] {
  return blocks.filter(b => {
    const blk = b as PortableTextBlock & { listItem?: string };
    if (blk._type !== "block" || blk.listItem) return true;
    const text = (blk.children ?? []).map(c => (c as { text?: string }).text ?? "").join("");
    return text.trim().length > 0;
  });
}

function inlineContent(source: JSONContent[], blockIndex: number): { spans: PTSpan[]; markDefs: PTMarkDef[] } {
  const markDefs: PTMarkDef[] = [];
  const spans = source.flatMap((child, i) => {
    if (child.type !== "text") return [] as PTSpan[];
    const marks: string[] = (child.marks ?? []).map((m: { type: string; attrs?: Record<string, string> }) => {
      if (m.type === "bold") return "strong";
      if (m.type === "italic") return "em";
      if (m.type === "link") {
        const key = `lnk${blockIndex}i${i}`;
        markDefs.push({ _key: key, _type: "link", href: m.attrs?.href ?? "" });
        return key;
      }
      return m.type;
    });
    return [{ _type: "span" as const, _key: `b${blockIndex}s${i}`, text: child.text ?? "", marks }];
  });
  return { spans, markDefs };
}

// Tiptap JSON → Portable Text blocks
export function tiptapToPortableText(doc: JSONContent): PortableTextBlock[] {
  const blocks: PortableTextBlock[] = [];
  let idx = 0;

  function pushTextBlock(node: JSONContent, style: string, listItem?: string) {
    const source =
      style === "blockquote" ? (node.content?.[0]?.content ?? []) : (node.content ?? []);
    const { spans, markDefs } = inlineContent(source, idx);
    if (spans.length === 0) spans.push({ _type: "span", _key: `b${idx}s0`, text: "", marks: [] });
    const block: PTBlock = { _type: "block", _key: `b${idx}`, style, markDefs, children: spans };
    if (listItem) { (block as PTBlock & { listItem: string; level: number }).listItem = listItem; (block as PTBlock & { listItem: string; level: number }).level = 1; }
    blocks.push(block as PortableTextBlock);
    idx++;
  }

  for (const node of doc.content ?? []) {
    if (node.type === "image") {
      blocks.push({ _type: "imageEmbed", _key: `b${idx}`, src: node.attrs?.src ?? "", alt: node.attrs?.alt ?? "" } as unknown as PortableTextBlock);
      idx++; continue;
    }
    if (node.type === "youtube") {
      blocks.push({ _type: "youtubeEmbed", _key: `b${idx}`, src: node.attrs?.src ?? "" } as unknown as PortableTextBlock);
      idx++; continue;
    }
    if (node.type === "bulletList") {
      for (const item of node.content ?? []) {
        pushTextBlock(item.content?.[0] ?? item, "normal", "bullet");
      }
      continue;
    }
    if (node.type === "orderedList") {
      for (const item of node.content ?? []) {
        pushTextBlock(item.content?.[0] ?? item, "normal", "number");
      }
      continue;
    }
    if (node.type === "heading") {
      pushTextBlock(node, node.attrs?.level === 2 ? "h2" : "h3");
      continue;
    }
    if (node.type === "blockquote") {
      pushTextBlock(node, "blockquote");
      continue;
    }
    // paragraph / fallback
    pushTextBlock(node, "normal");
  }

  return blocks;
}

// Portable Text blocks → Tiptap JSON
export function portableTextToTiptap(blocks: PortableTextBlock[]): JSONContent {
  const nodes: JSONContent[] = [];
  let i = 0;

  function spansToInline(spans: { text: string; marks?: string[] }[], markDefs: PTMarkDef[]): JSONContent[] {
    return spans.map(span => {
      const marks: JSONContent["marks"] = (span.marks ?? []).map(m => {
        if (m === "strong") return { type: "bold" };
        if (m === "em") return { type: "italic" };
        const def = markDefs.find(d => d._key === m);
        if (def?._type === "link") return { type: "link", attrs: { href: def.href ?? "" } };
        return { type: m };
      });
      return { type: "text", text: span.text, ...(marks.length ? { marks } : {}) };
    });
  }

  while (i < blocks.length) {
    const b = blocks[i] as PortableTextBlock & { style?: string; listItem?: string; markDefs?: PTMarkDef[] };

    if (b._type === "imageEmbed") {
      const eb = b as unknown as { src: string; alt?: string };
      nodes.push({ type: "image", attrs: { src: eb.src, alt: eb.alt ?? "" } });
      i++; continue;
    }
    if (b._type === "youtubeEmbed") {
      const eb = b as unknown as { src: string };
      nodes.push({ type: "youtube", attrs: { src: eb.src } });
      i++; continue;
    }
    if (b._type !== "block") { i++; continue; }

    const style = b.style ?? "normal";
    const spans = (b.children ?? []) as { text: string; marks?: string[] }[];
    const markDefs = b.markDefs ?? [];
    const inline = spansToInline(spans, markDefs);

    if (b.listItem === "bullet") {
      const items: JSONContent[] = [];
      while (i < blocks.length) {
        const bi = blocks[i] as PTBlock & { listItem?: string };
        if (bi._type !== "block" || bi.listItem !== "bullet") break;
        const s = (bi.children ?? []) as { text: string; marks?: string[] }[];
        items.push({ type: "listItem", content: [{ type: "paragraph", content: spansToInline(s, bi.markDefs ?? []) }] });
        i++;
      }
      nodes.push({ type: "bulletList", content: items });
      continue;
    }
    if (b.listItem === "number") {
      const items: JSONContent[] = [];
      while (i < blocks.length) {
        const bi = blocks[i] as PTBlock & { listItem?: string };
        if (bi._type !== "block" || bi.listItem !== "number") break;
        const s = (bi.children ?? []) as { text: string; marks?: string[] }[];
        items.push({ type: "listItem", content: [{ type: "paragraph", content: spansToInline(s, bi.markDefs ?? []) }] });
        i++;
      }
      nodes.push({ type: "orderedList", content: items });
      continue;
    }

    if (style === "h2") nodes.push({ type: "heading", attrs: { level: 2 }, content: inline });
    else if (style === "h3") nodes.push({ type: "heading", attrs: { level: 3 }, content: inline });
    else if (style === "blockquote") nodes.push({ type: "blockquote", content: [{ type: "paragraph", content: inline }] });
    else nodes.push({ type: "paragraph", content: inline });
    i++;
  }

  return { type: "doc", content: nodes };
}
