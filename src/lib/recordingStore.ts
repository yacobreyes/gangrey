import fs from "fs";
import path from "path";

// Storage + edit layer for the standalone /recording page (a self-contained
// HTML bundle). The live copy lives on the DATA_DIR volume so edits made in
// the admin editor survive deploys; the repo's public/recording.html is the
// pristine seed (and the "reset" source).
//
// The bundle keeps its page markup as ONE JSON string inside
// <script type="__bundler/template">…</script> (the loader JSON.parse's it).
// Inside that template source, the transcript lines are JS object literals
// like  {k:'r',sp:'JUAN',tc:'00:52',t:'Really?\" he scoffs. \"How?'}  — i.e.
// single-quoted JS strings with their own escape layer. So text passes
// through two encodings: the JS-string layer, then the JSON layer. Editing
// works at the template-source level: JSON.parse once, edit, JSON.stringify
// back.

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

function livePath(): string {
  return path.join(dataDir(), "recording.html");
}

function seedPath(): string {
  return path.join(process.cwd(), "public", "recording.html");
}

// Returns the path of the copy /recording should serve, seeding the live
// copy from the bundled one on first use.
export function recordingFilePath(): string {
  const live = livePath();
  if (!fs.existsSync(live)) {
    try {
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.copyFileSync(seedPath(), live);
    } catch {
      return seedPath(); // read-only fallback: serve the bundled copy
    }
  }
  return live;
}

export function resetRecordingToBundled(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.copyFileSync(seedPath(), livePath());
}

// --- template extraction -----------------------------------------------------

const OPEN = '<script type="__bundler/template">';

function readFileText(): string {
  return fs.readFileSync(recordingFilePath(), "utf-8");
}

// Splits the file into [before, templateSource, after]; templateSource is the
// JSON-decoded page markup.
function splitTemplate(html: string): { before: string; template: string; after: string } {
  const i = html.indexOf(OPEN);
  if (i < 0) throw new Error("recording bundle: template script not found");
  const start = i + OPEN.length;
  const end = html.indexOf("</script>", start);
  if (end < 0) throw new Error("recording bundle: template script not closed");
  const raw = html.slice(start, end).trim();
  return {
    before: html.slice(0, start),
    template: JSON.parse(raw) as string,
    after: html.slice(end),
  };
}

function joinTemplate(parts: { before: string; template: string; after: string }): string {
  // JSON.stringify escapes ", \ and control chars — the same shape the bundle
  // shipped with. "</" sequences inside the JSON string would end the host
  // <script> early, so escape the slash (valid JSON, ignored by JSON.parse).
  const raw = JSON.stringify(parts.template).replace(/<\//g, "<\\u002F");
  return `${parts.before}\n${raw}\n  ${parts.after}`;
}

// --- the JS-string escape layer (inside the template source) -----------------

function jsDecode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, "\n")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function jsEncode(s: string): string {
  return s.replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/—/g, "\\u2014")
    .replace(/’/g, "\\u2019")
    .replace(/‘/g, "\\u2018")
    .replace(/“/g, "\\u201C")
    .replace(/”/g, "\\u201D");
}

// --- transcript lines ---------------------------------------------------------

export type RecordingLine = {
  index: number;      // stable ordinal of the t:'…' occurrence in the template
  speaker: string | null;
  timecode: string | null;
  text: string;       // decoded, human-editable
};

// Matches a single-quoted JS string value for a `t:` key. At template-source
// level, escapes are single backslashes, so (?:\\.|[^'\\])* is the standard
// "escaped or plain char" scan.
const LINE_RE = /([{,]\s*)t:'((?:\\.|[^'\\])*)'/g;

export function listRecordingLines(): RecordingLine[] {
  const { template } = splitTemplate(readFileText());
  const out: RecordingLine[] = [];
  let m: RegExpExecArray | null;
  let index = 0;
  LINE_RE.lastIndex = 0;
  while ((m = LINE_RE.exec(template))) {
    // Pull speaker/timecode from the same object literal: scan back to the
    // nearest '{' and look for sp:'…' / tc:'…' in that span.
    const objStart = template.lastIndexOf("{", m.index);
    const ctx = template.slice(objStart, m.index + 1);
    const sp = /sp:'((?:\\.|[^'\\])*)'/.exec(ctx);
    const tc = /tc:'((?:\\.|[^'\\])*)'/.exec(ctx);
    out.push({
      index: index++,
      speaker: sp ? jsDecode(sp[1]) : null,
      timecode: tc ? jsDecode(tc[1]) : null,
      text: jsDecode(m[2]),
    });
  }
  return out;
}

export function saveRecordingLine(index: number, newText: string): void {
  const html = readFileText();
  const parts = splitTemplate(html);
  let i = 0;
  let hit = false;
  parts.template = parts.template.replace(LINE_RE, (whole, prefix: string) => {
    if (i++ !== index) return whole;
    hit = true;
    return `${prefix}t:'${jsEncode(newText)}'`;
  });
  if (!hit) throw new Error(`Line ${index} not found — the page may have changed; reload the editor.`);
  fs.writeFileSync(livePath(), joinTemplate(parts));
}

// --- generic find & replace ---------------------------------------------------

// Replaces every occurrence of `find`, both as plain markup text and as
// JS-string-escaped text (covers transcript lines, labels, narration, and any
// on-page HTML). Returns how many occurrences were replaced.
export function findReplaceRecording(find: string, replace: string): number {
  if (!find) return 0;
  const parts = splitTemplate(readFileText());
  let count = 0;
  const sub = (hay: string, needle: string, repl: string): string => {
    if (!needle || !hay.includes(needle)) return hay;
    const n = hay.split(needle).length - 1;
    count += n;
    return hay.split(needle).join(repl);
  };
  parts.template = sub(parts.template, find, replace);
  const encFind = jsEncode(find);
  if (encFind !== find) parts.template = sub(parts.template, encFind, jsEncode(replace));
  if (count > 0) fs.writeFileSync(livePath(), joinTemplate(parts));
  return count;
}
