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

  it("the unmodified live copy still JSON-parses (sanity on the seed itself)", () => {
    expect(() => JSON.parse(extractTemplateRaw(liveHtml()))).not.toThrow();
  });
});
