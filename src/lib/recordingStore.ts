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
// copy from the bundled one on first use. Also upgrades the live copy's
// player code in place when a newer patch exists (see patchPlayerFade) —
// the live copy may carry old player code from before a feature was added,
// and re-seeding would throw away the user's edits.
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
  try {
    const html = fs.readFileSync(live, "utf-8");
    const parts = splitTemplate(html);
    const patched = patchPlayerFade(parts.template);
    if (patched !== parts.template) {
      fs.writeFileSync(live, joinTemplate({ ...parts, template: patched }));
    }
  } catch { /* serve as-is if the upgrade can't apply */ }
  return live;
}

// Teaches the bundle's audio player per-clip fades: fi (fade-in seconds) and
// fo (fade-out seconds) on a beat, ramped through a Web Audio gain node (an
// <audio> volume ramp is ignored on iOS). Pure text transform on the template
// source, applied idempotently — the marker comment guards re-application.
export function patchPlayerFade(template: string): string {
  if (template.includes("/* fade-patch */")) return template;
  let t = template;
  const swaps: [string, string][] = [
    // effClip carries the beat's fades through to the play call (audio
    // overrides keep their own start/end; fades always come from the beat).
    [
      "return { clip: b.clip || '', start:defStart, end:defEnd };",
      "return { clip: b.clip || '', start:defStart, end:defEnd, fi:(b.fi!=null?+b.fi:0), fo:(b.fo!=null?+b.fo:0) };",
    ],
    [
      "end: (ov.end != null ? +ov.end : defEnd)",
      "end: (ov.end != null ? +ov.end : defEnd), fi:(b.fi!=null?+b.fi:0), fo:(b.fo!=null?+b.fo:0)",
    ],
    [
      "if(eff.clip){ this.playClip(s.step, eff.clip, eff.start, eff.end); }",
      "if(eff.clip){ this.playClip(s.step, eff.clip, eff.start, eff.end, eff.fi, eff.fo); }",
    ],
    [
      "if(this._curKey !== key){ this.playClip(step, eff.clip, eff.start, eff.end); }",
      "if(this._curKey !== key){ this.playClip(step, eff.clip, eff.start, eff.end, eff.fi, eff.fo); }",
    ],
    [
      "this.playClip(i, eff.clip, eff.start, eff.end);",
      "this.playClip(i, eff.clip, eff.start, eff.end, eff.fi, eff.fo);",
    ],
    ["playClip(i, src, start, end){", "playClip(i, src, start, end, fi, fo){"],
    [
      "this._endTime = (end != null ? +end : null);",
      "this._endTime = (end != null ? +end : null);\n    /* fade-patch */\n" +
      "    this._fi = (fi != null ? +fi : 0) || 0;\n" +
      "    this._fo = (fo != null ? +fo : 0) || 0;\n" +
      "    this._t0 = start || 0;\n" +
      "    if(!this._gainCtx && (this._fi > 0 || this._fo > 0) && (window.AudioContext || window.webkitAudioContext)){\n" +
      "      try {\n" +
      "        this._gainCtx = new (window.AudioContext || window.webkitAudioContext)();\n" +
      "        this._gainNode = this._gainCtx.createGain();\n" +
      "        this._gainCtx.createMediaElementSource(audio).connect(this._gainNode);\n" +
      "        this._gainNode.connect(this._gainCtx.destination);\n" +
      "      } catch(e){ this._gainCtx = null; this._gainNode = null; }\n" +
      "    }\n" +
      "    if(this._gainCtx && this._gainCtx.state === 'suspended'){ try{ this._gainCtx.resume(); }catch(e){} }\n" +
      "    if(this._fadeTimer){ clearInterval(this._fadeTimer); this._fadeTimer = null; }\n" +
      "    const setVol = (v) => { if(this._gainNode) this._gainNode.gain.value = v; else { try{ audio.volume = v; }catch(e){} } };\n" +
      "    if(this._fi > 0 || this._fo > 0){\n" +
      "      setVol(this._fi > 0 ? 0 : 1);\n" +
      "      this._fadeTimer = setInterval(() => {\n" +
      "        const ct = audio.currentTime; let v = 1;\n" +
      "        if(this._fi > 0 && ct < this._t0 + this._fi) v = Math.min(v, Math.max(0, (ct - this._t0) / this._fi));\n" +
      "        if(this._fo > 0 && this._endTime != null && ct > this._endTime - this._fo) v = Math.min(v, Math.max(0, (this._endTime - ct) / this._fo));\n" +
      "        setVol(Math.max(0, Math.min(1, v)));\n" +
      "        if(audio.paused){ clearInterval(this._fadeTimer); this._fadeTimer = null; setVol(1); }\n" +
      "      }, 40);\n" +
      "    } else { setVol(1); }",
    ],
  ];
  for (const [from, to] of swaps) {
    if (!t.includes(from)) return template; // player code changed — skip whole patch rather than half-apply
    t = t.replace(from, to);
  }
  return t;
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

// --- audio clip timings --------------------------------------------------------

export type RecordingClip = {
  index: number;       // ordinal of the clip:'…' occurrence in the template
  file: string;        // e.g. "assets/clip-we-can-do-it-tonight.mp3"
  start: number | null; // cs — seconds into the file playback begins (null = 0)
  end: number | null;   // ce — seconds where playback stops (null = play to end)
  fadeIn: number | null;  // fi — seconds of fade-in from the start point
  fadeOut: number | null; // fo — seconds of fade-out into the end point
  snippet: string;      // nearby transcript text, for identifying the clip
};

// A clip's trim/fade params sit immediately after its src in the same object
// literal: clip:'assets/x.mp3',cs:1.5,ce:2.8,fi:0.3,fo:0.5 — all optional.
const CLIP_RE = /clip:'((?:\\.|[^'\\])*)'((?:,(?:cs|ce|fi|fo):[0-9.]+)*)/g;

function parseClipParams(params: string): { start: number | null; end: number | null; fadeIn: number | null; fadeOut: number | null } {
  const n = (k: string) => {
    const m = new RegExp(`,${k}:([0-9.]+)`).exec(params);
    return m ? Number(m[1]) : null;
  };
  return { start: n("cs"), end: n("ce"), fadeIn: n("fi"), fadeOut: n("fo") };
}

export function listRecordingClips(): RecordingClip[] {
  const { template } = splitTemplate(readFileText());
  const out: RecordingClip[] = [];
  let m: RegExpExecArray | null;
  let index = 0;
  CLIP_RE.lastIndex = 0;
  while ((m = CLIP_RE.exec(template))) {
    // Identify the clip by the first transcript text that follows it.
    const window = template.slice(m.index, m.index + 400);
    const t = /t:'((?:\\.|[^'\\])*)'/.exec(window);
    const text = t ? jsDecode(t[1]) : "";
    out.push({
      index: index++,
      file: jsDecode(m[1]),
      ...parseClipParams(m[2]),
      snippet: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    });
  }
  return out;
}

export function saveRecordingClipTiming(
  index: number, start: number | null, end: number | null,
  fadeIn: number | null = null, fadeOut: number | null = null,
): void {
  if (start !== null && (!Number.isFinite(start) || start < 0)) throw new Error("Start must be a non-negative number of seconds.");
  if (end !== null && (!Number.isFinite(end) || end <= 0)) throw new Error("End must be a positive number of seconds.");
  if (start !== null && end !== null && end <= start) throw new Error("End must be after start.");
  if (fadeIn !== null && (!Number.isFinite(fadeIn) || fadeIn < 0)) throw new Error("Fade in must be a non-negative number of seconds.");
  if (fadeOut !== null && (!Number.isFinite(fadeOut) || fadeOut < 0)) throw new Error("Fade out must be a non-negative number of seconds.");
  if (fadeOut !== null && fadeOut > 0 && end === null) throw new Error("Fade out needs an End time to fade into.");
  const parts = splitTemplate(readFileText());
  parts.template = patchPlayerFade(parts.template);
  let i = 0;
  let hit = false;
  parts.template = parts.template.replace(CLIP_RE, (whole, src: string) => {
    if (i++ !== index) return whole;
    hit = true;
    const cs = start !== null && start > 0 ? `,cs:${start}` : "";
    const ce = end !== null ? `,ce:${end}` : "";
    const fi = fadeIn !== null && fadeIn > 0 ? `,fi:${fadeIn}` : "";
    const fo = fadeOut !== null && fadeOut > 0 ? `,fo:${fadeOut}` : "";
    return `clip:'${src}'${cs}${ce}${fi}${fo}`;
  });
  if (!hit) throw new Error(`Clip ${index} not found — the page may have changed; reload the editor.`);
  fs.writeFileSync(livePath(), joinTemplate(parts));
}

// --- embedded asset extraction (for in-editor audio preview) -------------------

// The bundle embeds every asset as base64 in two JSON blobs: a manifest
// mapping id → uuid, and a resources map of uuid → {mime, data}. Pull one
// asset's bytes out so the admin editor can play the audio being trimmed.
export function getRecordingAsset(id: string): { mime: string; data: Buffer } | null {
  const html = readFileText();
  const idKey = `"id":${JSON.stringify(id)},"uuid":"`;
  const i = html.indexOf(idKey);
  if (i < 0) return null;
  const uuid = html.slice(i + idKey.length, html.indexOf('"', i + idKey.length));
  const resKey = `"${uuid}":{"mime":"`;
  const j = html.indexOf(resKey);
  if (j < 0) return null;
  const mime = html.slice(j + resKey.length, html.indexOf('"', j + resKey.length));
  const dataKey = '"data":"';
  const k = html.indexOf(dataKey, j);
  if (k < 0) return null;
  const b64 = html.slice(k + dataKey.length, html.indexOf('"', k + dataKey.length));
  const gz = html.slice(j, k).includes('"compressed":true');
  try {
    const raw = Buffer.from(b64, "base64");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return { mime, data: gz ? require("zlib").gunzipSync(raw) : raw };
  } catch {
    return null;
  }
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
