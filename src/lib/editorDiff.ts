import type { PortableTextBlock } from "@portabletext/types";

// Shared "what changed" diff + audit helpers for the story and newsletter
// editors. Kept loosely typed so it works on both tiptap docs and portable
// text without dragging heavy editor types across module boundaries.

export type DiffOp = { type: "same" | "del" | "add"; text: string };

// Line-level LCS diff: aligns unchanged paragraphs and flags removed/added ones.
export function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "del", text: a[i] }); i++; }
    else { ops.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < n) ops.push({ type: "del", text: a[i++] });
  while (j < m) ops.push({ type: "add", text: b[j++] });
  return ops;
}

export function portableToLines(body: PortableTextBlock[] | undefined): string[] {
  return (body ?? [])
    .filter(b => (b as { _type?: string })?._type === "block")
    .map(b => ((b as { children?: { text?: string }[] }).children ?? []).map(c => c.text ?? "").join("").trim())
    .filter(Boolean);
}

type TiptapNode = { type?: string; text?: string; content?: TiptapNode[] };
export function tiptapToLines(doc: { content?: TiptapNode[] } | null | undefined): string[] {
  return (doc?.content ?? [])
    .map(n => (n.content ?? []).map(c => c.text ?? "").join("").trim())
    .filter(Boolean);
}

// Word-level diff within a single paragraph, tokenized on whitespace (kept as
// tokens so spacing reconstructs exactly). Adjacent same-type runs are merged
// so rendered redlines are clean spans, not one span per word.
export function diffTokensText(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split(/(\s+)/).filter(Boolean);
  const b = newText.split(/(\s+)/).filter(Boolean);
  const raw = diffLines(a, b);
  const merged: DiffOp[] = [];
  for (const op of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) last.text += op.text;
    else merged.push({ ...op });
  }
  return merged;
}

// Google-Docs-style redline: one paragraph per line, with modified paragraphs
// showing inline word-level add/delete runs. `same` paragraphs render plain;
// a deleted paragraph is struck through; an added one is highlighted.
export type RedlinePara = { key: string; runs: DiffOp[]; changed: boolean };

export function redlineParagraphs(oldLines: string[], newLines: string[]): RedlinePara[] {
  const ops = diffLines(oldLines, newLines);
  const out: RedlinePara[] = [];
  let k = 0, idx = 0;
  while (idx < ops.length) {
    const op = ops[idx];
    if (op.type === "same") {
      out.push({ key: `s${k++}`, runs: [{ type: "same", text: op.text }], changed: false });
      idx++;
      continue;
    }
    // Collect a maximal change region, then pair deletions with additions
    // (index-wise) so a reworded paragraph shows inline word changes.
    const dels: string[] = [], adds: string[] = [];
    while (idx < ops.length && ops[idx].type !== "same") {
      if (ops[idx].type === "del") dels.push(ops[idx].text);
      else adds.push(ops[idx].text);
      idx++;
    }
    const max = Math.max(dels.length, adds.length);
    for (let p = 0; p < max; p++) {
      if (p < dels.length && p < adds.length) out.push({ key: `m${k++}`, runs: diffTokensText(dels[p], adds[p]), changed: true });
      else if (p < dels.length) out.push({ key: `d${k++}`, runs: [{ type: "del", text: dels[p] }], changed: true });
      else out.push({ key: `a${k++}`, runs: [{ type: "add", text: adds[p] }], changed: true });
    }
  }
  return out;
}

// "2 hours ago" style relative time for the audit stamp.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}
