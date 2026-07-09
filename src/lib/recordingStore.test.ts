import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// The /recording bundle editor rewrites a 7MB single-file HTML bundle whose
// page markup lives as ONE JSON string in a <script> tag, with transcript
// text carrying a second (JS-string) escape layer inside it. A bad rewrite
// bricks the whole page, so these tests exercise the real bundled file:
// list → edit → re-read must round-trip, and the rewritten template must
// still JSON.parse and contain no raw "</script>" inside the JSON string.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rec-store-"));
process.env.DATA_DIR = tmp;

const {
  listRecordingLines, saveRecordingLine, findReplaceRecording,
  resetRecordingToBundled, recordingFilePath,
  listRecordingClips, saveRecordingClipTiming, getRecordingAsset, patchPlayerFade,
} = await import("./recordingStore");

beforeEach(() => {
  resetRecordingToBundled();
});

function liveHtml(): string {
  return fs.readFileSync(path.join(tmp, "recording.html"), "utf-8");
}

function extractTemplateRaw(html: string): string {
  const open = '<script type="__bundler/template">';
  const i = html.indexOf(open) + open.length;
  return html.slice(i, html.indexOf("</script>", i)).trim();
}

describe("recordingStore", () => {
  it("seeds the live copy from the bundled file", () => {
    expect(recordingFilePath()).toBe(path.join(tmp, "recording.html"));
    expect(fs.existsSync(path.join(tmp, "recording.html"))).toBe(true);
  });

  it("lists transcript lines with decoded text and speaker context", () => {
    const lines = listRecordingLines();
    expect(lines.length).toBeGreaterThan(5);
    const juan = lines.find(l => l.text.startsWith("Really?"));
    expect(juan?.speaker).toBe("JUAN");
    // Decoding: the file stores \" for in-line quotes; the editor shows ".
    expect(juan?.text).toContain('"How?');
  });

  it("saves an edited line and reads the same text back", () => {
    const lines = listRecordingLines();
    const target = lines.find(l => l.speaker === "JUAN" && l.text.startsWith("Really?"))!;
    saveRecordingLine(target.index, 'He scoffs — "how?"');
    const after = listRecordingLines();
    expect(after[target.index].text).toBe('He scoffs — "how?"');
    // Every other line is untouched.
    expect(after.length).toBe(lines.length);
    for (const l of after) if (l.index !== target.index) expect(l.text).toBe(lines[l.index].text);
  });

  it("keeps the rewritten template valid JSON with no </script> leak", () => {
    const lines = listRecordingLines();
    saveRecordingLine(lines[0].index, "It's a new line with 'quotes' and a — dash.\nAnd a second line.");
    const raw = extractTemplateRaw(liveHtml());
    expect(raw).not.toContain("</script>");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toContain("second line");
  });

  it("find & replace hits JS-string-escaped transcript text", () => {
    const n = findReplaceRecording('Really?" he scoffs. "How?', 'Seriously?" he scoffs. "How?');
    expect(n).toBeGreaterThan(0);
    const lines = listRecordingLines();
    expect(lines.some(l => l.text.startsWith("Seriously?"))).toBe(true);
  });

  it("find & replace returns 0 and writes nothing on a miss", () => {
    listRecordingLines(); // first read applies the player auto-upgrade; settle it before snapshotting
    const before = liveHtml();
    expect(findReplaceRecording("text that is definitely not on the page", "x")).toBe(0);
    expect(liveHtml()).toBe(before);
  });

  it("reset restores the bundled original", () => {
    const lines = listRecordingLines();
    saveRecordingLine(lines[0].index, "scribbled over");
    resetRecordingToBundled();
    expect(listRecordingLines()[0].text).toBe(lines[0].text);
  });

  it("lists audio clips with their trim timings", () => {
    const clips = listRecordingClips();
    expect(clips.length).toBeGreaterThan(3);
    const juan = clips.find(c => c.file.includes("we-can-do-it-tonight") && c.start !== null);
    expect(juan?.start).toBe(1.35);
    const susana = clips.find(c => c.file.includes("we-can-do-it-tonight") && c.end === 0.7);
    expect(susana).toBeTruthy();
  });

  it("saves new clip timings and reads them back", () => {
    const clips = listRecordingClips();
    const target = clips.find(c => c.start === 1.35)!;
    saveRecordingClipTiming(target.index, 1.2, 2.28);
    const after = listRecordingClips();
    expect(after[target.index].start).toBe(1.2);
    expect(after[target.index].end).toBe(2.28);
    // Others untouched, order stable.
    for (const c of after) if (c.index !== target.index) {
      expect(c.start).toBe(clips[c.index].start);
      expect(c.end).toBe(clips[c.index].end);
    }
    // Blank = full clip: clears both params entirely.
    saveRecordingClipTiming(target.index, null, null);
    const cleared = listRecordingClips()[target.index];
    expect(cleared.start).toBeNull();
    expect(cleared.end).toBeNull();
  });

  it("rejects nonsense timings", () => {
    expect(() => saveRecordingClipTiming(0, -1, null)).toThrow();
    expect(() => saveRecordingClipTiming(0, 2, 1)).toThrow();
  });

  it("clip-timing rewrite keeps the template valid JSON", () => {
    saveRecordingClipTiming(0, 0.5, 3);
    expect(() => JSON.parse(extractTemplateRaw(liveHtml()))).not.toThrow();
  });

  it("saves and clears fade timings", () => {
    const clips = listRecordingClips();
    const target = clips.find(c => c.end !== null)!;
    saveRecordingClipTiming(target.index, target.start, target.end, 0.3, 0.5);
    let after = listRecordingClips()[target.index];
    expect(after.fadeIn).toBe(0.3);
    expect(after.fadeOut).toBe(0.5);
    saveRecordingClipTiming(target.index, target.start, target.end, null, null);
    after = listRecordingClips()[target.index];
    expect(after.fadeIn).toBeNull();
    expect(after.fadeOut).toBeNull();
  });

  it("rejects a fade-out with no end time", () => {
    const clips = listRecordingClips();
    const open = clips.find(c => c.end === null)!;
    expect(() => saveRecordingClipTiming(open.index, open.start, null, null, 1)).toThrow(/End/);
  });

  it("player fade patch applies once, idempotently, and saving a fade installs it", () => {
    const clips = listRecordingClips();
    const target = clips.find(c => c.end !== null)!;
    saveRecordingClipTiming(target.index, target.start, target.end, 0.3, null);
    const template = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    expect(template).toContain("/* fade-patch */");
    expect(template).toContain("playClip(i, src, start, end, fi, fo){");
    expect(template).toContain("eff.fi, eff.fo");
    // Idempotent: re-applying changes nothing.
    expect(patchPlayerFade(template)).toBe(template);
  });

  it("extracts an embedded audio asset as playable bytes", () => {
    const asset = getRecordingAsset("assets/clip-we-can-do-it-tonight.mp3");
    expect(asset?.mime).toBe("audio/mpeg");
    expect(asset!.data.length).toBeGreaterThan(10_000);
    expect(getRecordingAsset("assets/nope.mp3")).toBeNull();
  });

  it("the unmodified live copy still JSON-parses (sanity on the seed itself)", () => {
    expect(() => JSON.parse(extractTemplateRaw(liveHtml()))).not.toThrow();
  });
});
