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
  listRecordingClips, saveRecordingClipTiming, getRecordingAsset, patchPlayerFade, patchIntroEndStyle,
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

  it("strips previously saved fade params from every clip on upgrade", () => {
    // Simulate a live copy carrying fades saved before the feature was removed.
    const html = liveHtml();
    const withFades = html.replace(
      "clip:'assets/clip-we-can-do-it-tonight.mp3',ce:0.7,",
      "clip:'assets/clip-we-can-do-it-tonight.mp3',ce:0.7,fi:0.3,fo:0.5,",
    );
    expect(withFades).not.toBe(html);
    fs.writeFileSync(path.join(tmp, "recording.html"), withFades);
    listRecordingLines(); // triggers the auto-upgrade
    const upgraded = liveHtml();
    expect(upgraded).not.toMatch(/,f[io]:[0-9.]+/);
    // The trim params survive the strip.
    const clip = listRecordingClips().find(c => c.end === 0.7);
    expect(clip).toBeTruthy();
  });

  it("player fade patch applies idempotently (engine stays, inert without fi/fo)", () => {
    listRecordingLines(); // triggers the auto-upgrade
    const template = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    expect(template).toContain("/* fade-patch v2 */");
    expect(template).toContain("playClip(i, src, start, end, fi, fo){");
    // Idempotent: re-applying changes nothing.
    expect(patchPlayerFade(template)).toBe(template);
  });

  it("intro/end style patch applies with the fade patch and is idempotent", () => {
    listRecordingLines(); // triggers the auto-upgrade on the live copy
    const template = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    expect(template).toContain("@keyframes trackin");
    expect(template).toContain("animation:dateIn");
    expect(template).toContain("animation:endTitle");
    expect(template).toContain("animation:subTrack");
    // Original single-shot animations are gone from the markup.
    expect(template).not.toContain('animation:endRise 1.1s .15s');
    expect(patchIntroEndStyle(template)).toBe(template);
  });

  it("extracts an embedded audio asset as playable bytes", () => {
    const asset = getRecordingAsset("assets/clip-we-can-do-it-tonight.mp3");
    expect(asset?.mime).toBe("audio/mpeg");
    expect(asset!.data.length).toBeGreaterThan(10_000);
    expect(getRecordingAsset("assets/nope.mp3")).toBeNull();
  });

  it("sms send sound is injected as a bundle asset and attached to the text beat", () => {
    listRecordingLines(); // triggers the file-level auto-upgrade
    const asset = getRecordingAsset("assets/sms-send.mp3");
    expect(asset?.mime).toBe("audio/mpeg");
    expect(asset!.data.length).toBeGreaterThan(10_000);
    // The clip is on the sms beat and shows up in the timing editor.
    const clips = listRecordingClips();
    const sms = clips.find(c => c.file === "assets/sms-send.mp3");
    expect(sms?.snippet).toContain("rape me");
    // Idempotent: a second read doesn't double-inject.
    listRecordingLines();
    const html = liveHtml();
    expect(html.split('"id":"assets/sms-send.mp3"').length - 1).toBe(1);
    expect(() => JSON.parse(extractTemplateRaw(html))).not.toThrow();
  });

  it("hides the dialogue timecodes but keeps tc data for audio scheduling", () => {
    listRecordingLines(); // triggers the auto-upgrade
    const template = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    expect(template).not.toContain("{{ b.tc }}");
    expect(template).toContain("tc:'00:52'"); // beat data intact
  });

  it("saved clip timings flow through to the served page (no localStorage masking)", () => {
    const clips = listRecordingClips();
    const target = clips.find(c => c.start === 1.35)!;
    saveRecordingClipTiming(target.index, 1.1, 2.2);
    const template = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    // The edit is in the served bytes...
    expect(template).toContain("clip:'assets/clip-we-can-do-it-tonight.mp3',cs:1.1,ce:2.2");
    // ...and the player no longer loads per-browser localStorage overrides
    // that would mask it (it clears the stale key instead).
    expect(template).not.toContain("ov = JSON.parse(localStorage.getItem(this.OVKEY)");
    expect(template).toContain("localStorage.removeItem(this.OVKEY)");
  });

  it("title card: opaque background paints instantly (no softin fade → no flash of the content behind)", () => {
    listRecordingLines(); // triggers the auto-upgrade
    const template = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    // The outer title card no longer fades from opacity 0...
    expect(template).not.toContain("#18130e, #0b0908);animation:softin .6s ease both");
    // ...but the inner entrance animations remain.
    expect(template).toContain("@keyframes dateIn");
  });

  it("nav bar (BACK/RESTART) is gated behind `started` so it can't flash on the title screen", () => {
    listRecordingLines();
    const template = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    expect(template).toContain('<sc-if value="{{ started }}"><div style="position:fixed;bottom:16px');
    expect(template).toContain("RESTART</button>\n      </div>\n    </div></sc-if>");
  });

  it("adds the sexual-assault disclaimer under the date, once", () => {
    listRecordingLines();
    const template = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    expect(template).toContain("Warning: This report contains references to sexual assault.");
    // Idempotent — a second upgrade pass doesn't duplicate it.
    listRecordingLines();
    const again = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    expect(again.split("Warning: This report contains references to sexual assault.").length - 1).toBe(1);
    expect(() => JSON.parse(extractTemplateRaw(liveHtml()))).not.toThrow();
  });

  it("migrates an earlier disclaimer wording in place (no duplicate warning)", () => {
    // Simulate a live copy already carrying the previous "details of" wording.
    const html = liveHtml();
    const anchor = "August 8, 2018</h1>";
    const oldEl = `${anchor}<div>Warning: This report contains details of sexual assault.</div>`;
    fs.writeFileSync(path.join(tmp, "recording.html"), html.replace(anchor, oldEl));
    listRecordingLines(); // triggers the upgrade
    const upgraded = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    expect(upgraded).not.toContain("details of sexual assault");
    expect(upgraded.split("references to sexual assault").length - 1).toBe(1);
  });

  it("applies the bus-stop caption copy fix", () => {
    listRecordingLines(); // triggers the auto-upgrade
    const template = JSON.parse(extractTemplateRaw(liveHtml())) as string;
    expect(template).toContain("Susana revisited the bus stop in Miami, Florida, on June 22, 2026.");
    expect(template).not.toContain("Susana and I revisited the bus stop");
  });

  it("the unmodified live copy still JSON-parses (sanity on the seed itself)", () => {
    expect(() => JSON.parse(extractTemplateRaw(liveHtml()))).not.toThrow();
  });
});
