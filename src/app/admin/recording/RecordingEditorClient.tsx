"use client";

import { useEffect, useRef, useState } from "react";
import type { RecordingLine, RecordingClip } from "@/lib/recordingStore";
import { updateRecordingLine, recordingFindReplace, recordingReset, getRecordingLines, getRecordingClips, updateRecordingClipTiming } from "../recordingActions";

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const CRIMSON = "#490000";
const BORDER = "#d8d3c8";
const MUTED = "#6f6a60";

export default function RecordingEditorClient({ initialLines, initialClips, loadError }: {
  initialLines: RecordingLine[];
  initialClips: RecordingClip[];
  loadError: string | null;
}) {
  const [lines, setLines] = useState(initialLines);
  const [clips, setClips] = useState(initialClips);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [clipDrafts, setClipDrafts] = useState<Record<number, { start: string; end: string; fadeIn: string; fadeOut: string }>>({});
  const [playing, setPlaying] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPreview() {
    if (fadeTimer.current) { clearInterval(fadeTimer.current); fadeTimer.current = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlaying(null);
  }
  useEffect(() => stopPreview, []);

  // Plays the clip exactly as the live page would: from the DRAFT start to the
  // draft end, with draft fades — so you can audition before saving.
  function playPreview(c: RecordingClip, d: { start: string; end: string; fadeIn: string; fadeOut: string }) {
    if (playing === c.index) { stopPreview(); return; }
    stopPreview();
    const start = d.start.trim() === "" ? 0 : Number(d.start) || 0;
    const end = d.end.trim() === "" ? null : Number(d.end) || null;
    const fi = d.fadeIn.trim() === "" ? 0 : Number(d.fadeIn) || 0;
    const fo = d.fadeOut.trim() === "" ? 0 : Number(d.fadeOut) || 0;
    const audio = new Audio(`/api/admin/recording-audio?file=${encodeURIComponent(c.file)}`);
    audioRef.current = audio;
    audio.currentTime = start;
    audio.volume = fi > 0 ? 0 : 1;
    audio.onended = () => stopPreview();
    audio.play().catch(() => stopPreview());
    setPlaying(c.index);
    fadeTimer.current = setInterval(() => {
      const ct = audio.currentTime;
      if (end !== null && ct >= end) { stopPreview(); return; }
      let v = 1;
      if (fi > 0 && ct < start + fi) v = Math.min(v, Math.max(0, (ct - start) / fi));
      if (fo > 0 && end !== null && ct > end - fo) v = Math.min(v, Math.max(0, (end - ct) / fo));
      try { audio.volume = Math.max(0, Math.min(1, v)); } catch { /* iOS ignores volume */ }
    }, 40);
  }
  const [busy, setBusy] = useState<number | string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");

  async function refresh() {
    try {
      const [ls, cs] = await Promise.all([getRecordingLines(), getRecordingClips()]);
      setLines(ls); setClips(cs); setDrafts({}); setClipDrafts({});
    } catch { /* keep current */ }
  }

  async function saveClip(index: number) {
    const d = clipDrafts[index];
    if (!d) return;
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const start = num(d.start), end = num(d.end), fadeIn = num(d.fadeIn), fadeOut = num(d.fadeOut);
    if ([start, end, fadeIn, fadeOut].some(v => v !== null && !Number.isFinite(v))) {
      setMsg("Timings must be numbers (seconds, decimals ok) — leave blank for none.");
      return;
    }
    setBusy(`clip${index}`); setMsg(null);
    const r = await updateRecordingClipTiming(index, start, end, fadeIn, fadeOut);
    setBusy(null);
    if (r.ok) {
      setClips(cs => cs.map(c => (c.index === index ? {
        ...c,
        start: start !== null && start > 0 ? start : null,
        end,
        fadeIn: fadeIn !== null && fadeIn > 0 ? fadeIn : null,
        fadeOut: fadeOut !== null && fadeOut > 0 ? fadeOut : null,
      } : c)));
      setClipDrafts(cd => { const n = { ...cd }; delete n[index]; return n; });
      setMsg("Timing saved. Refresh /recording and replay the clip to hear it.");
    } else setMsg(r.error ?? "Save failed.");
  }

  async function saveLine(index: number) {
    const text = drafts[index];
    if (text === undefined) return;
    setBusy(index); setMsg(null);
    const r = await updateRecordingLine(index, text);
    setBusy(null);
    if (r.ok) {
      setLines(ls => ls.map(l => (l.index === index ? { ...l, text } : l)));
      setDrafts(d => { const n = { ...d }; delete n[index]; return n; });
      setMsg("Saved. Refresh /recording to see it.");
    } else setMsg(r.error ?? "Save failed.");
  }

  async function runFindReplace() {
    if (!find) return;
    setBusy("fr"); setMsg(null);
    const r = await recordingFindReplace(find, repl);
    setBusy(null);
    if (!r.ok) { setMsg(r.error ?? "Replace failed."); return; }
    setMsg(r.count === 0 ? "No matches — check the exact text (it's case-sensitive)." : `Replaced ${r.count} occurrence${r.count === 1 ? "" : "s"}.`);
    if (r.count > 0) { setFind(""); setRepl(""); await refresh(); }
  }

  async function doReset() {
    if (!confirm("Throw away ALL edits and restore the original bundled page?")) return;
    setBusy("reset"); setMsg(null);
    const r = await recordingReset();
    setBusy(null);
    setMsg(r.ok ? "Restored the original page." : (r.error ?? "Reset failed."));
    if (r.ok) await refresh();
  }

  const input: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", fontFamily: FONT, fontSize: "0.95rem",
    padding: "0.55rem 0.7rem", border: `1px solid ${BORDER}`, background: "#fff", color: "#111",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f1ea", fontFamily: FONT, color: "#111" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "2.2rem 1.2rem 5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem" }}>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "1.6rem", margin: 0 }}>Susana&rsquo;s Recording — Editor</h1>
          <div style={{ display: "flex", gap: "1rem", alignItems: "baseline" }}>
            <a href="/recording" target="_blank" rel="noreferrer" style={{ color: CRIMSON, fontSize: "0.85rem" }}>View page ↗</a>
            <button onClick={doReset} disabled={busy !== null}
              style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, fontFamily: FONT, fontSize: "0.78rem", padding: "0.3rem 0.7rem", cursor: "pointer" }}>
              {busy === "reset" ? "Restoring…" : "Restore original"}
            </button>
          </div>
        </div>
        <p style={{ color: MUTED, fontSize: "0.85rem", margin: "0.5rem 0 1.8rem", lineHeight: 1.5 }}>
          Edit any transcript line below, or fix any other on-page text with find &amp; replace.
          Changes go live the moment you save — refresh /recording to see them.
        </p>

        {msg && (
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderLeft: `3px solid ${CRIMSON}`, padding: "0.6rem 0.9rem", fontSize: "0.85rem", marginBottom: "1.2rem" }}>
            {msg}
          </div>
        )}

        <section style={{ background: "#fff", border: `1px solid ${BORDER}`, padding: "1rem 1.1rem 1.2rem", marginBottom: "2rem" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: MUTED, marginBottom: "0.7rem" }}>
            Find &amp; replace (any text on the page)
          </div>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <input style={input} placeholder="Exact text as it appears on the page" value={find} onChange={e => setFind(e.target.value)} />
            <input style={input} placeholder="Replace with" value={repl} onChange={e => setRepl(e.target.value)} />
            <button onClick={runFindReplace} disabled={!find || busy !== null}
              style={{ justifySelf: "start", background: CRIMSON, color: "#fff", border: "none", fontFamily: FONT, fontSize: "0.85rem", padding: "0.5rem 1.1rem", cursor: find && busy === null ? "pointer" : "default", opacity: !find || busy !== null ? 0.5 : 1 }}>
              {busy === "fr" ? "Replacing…" : "Replace all"}
            </button>
          </div>
        </section>

        <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: MUTED, marginBottom: "0.7rem" }}>
          Audio clip timing ({clips.length})
        </div>
        <p style={{ color: MUTED, fontSize: "0.8rem", margin: "0 0 0.8rem", lineHeight: 1.5 }}>
          All values are seconds into the audio file (decimals fine, e.g. 1.35). Blank Start/End = play the whole file.
          Fades ramp the volume over that many seconds after Start / before End. Press ▶ to hear it with your current numbers before saving.
        </p>
        <div style={{ display: "grid", gap: "0.8rem", marginBottom: "2rem" }}>
          {clips.map(c => {
            const d = clipDrafts[c.index] ?? { start: c.start?.toString() ?? "", end: c.end?.toString() ?? "", fadeIn: c.fadeIn?.toString() ?? "", fadeOut: c.fadeOut?.toString() ?? "" };
            const dirty = d.start !== (c.start?.toString() ?? "") || d.end !== (c.end?.toString() ?? "")
              || d.fadeIn !== (c.fadeIn?.toString() ?? "") || d.fadeOut !== (c.fadeOut?.toString() ?? "");
            const setD = (patch: Partial<{ start: string; end: string; fadeIn: string; fadeOut: string }>) =>
              setClipDrafts(cd => ({ ...cd, [c.index]: { ...d, ...patch } }));
            return (
              <div key={c.index} style={{ background: "#fff", border: `1px solid ${BORDER}`, padding: "0.8rem 0.9rem" }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#111", marginBottom: "0.15rem" }}>
                  {c.file.replace(/^assets\//, "")}
                </div>
                {c.snippet && <div style={{ fontSize: "0.8rem", color: MUTED, fontStyle: "italic", marginBottom: "0.55rem" }}>&ldquo;{c.snippet}&rdquo;</div>}
                <div style={{ display: "flex", gap: "0.7rem", alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={() => playPreview(c, d)} title={playing === c.index ? "Stop" : "Play with current numbers"}
                    style={{ background: playing === c.index ? CRIMSON : "#fff", color: playing === c.index ? "#fff" : CRIMSON, border: `1px solid ${CRIMSON}`, width: "2.2rem", height: "2.2rem", fontSize: "0.9rem", cursor: "pointer", flexShrink: 0 }}>
                    {playing === c.index ? "■" : "▶"}
                  </button>
                  <label style={{ fontSize: "0.75rem", color: MUTED }}>
                    Start{" "}
                    <input value={d.start} onChange={e => setD({ start: e.target.value })} inputMode="decimal" placeholder="0"
                      style={{ ...input, width: "5rem", display: "inline-block" }} />
                  </label>
                  <label style={{ fontSize: "0.75rem", color: MUTED }}>
                    End{" "}
                    <input value={d.end} onChange={e => setD({ end: e.target.value })} inputMode="decimal" placeholder="(end)"
                      style={{ ...input, width: "5rem", display: "inline-block" }} />
                  </label>
                  <label style={{ fontSize: "0.75rem", color: MUTED }}>
                    Fade in{" "}
                    <input value={d.fadeIn} onChange={e => setD({ fadeIn: e.target.value })} inputMode="decimal" placeholder="0"
                      style={{ ...input, width: "4.5rem", display: "inline-block" }} />
                  </label>
                  <label style={{ fontSize: "0.75rem", color: MUTED }}>
                    Fade out{" "}
                    <input value={d.fadeOut} onChange={e => setD({ fadeOut: e.target.value })} inputMode="decimal" placeholder="0"
                      style={{ ...input, width: "4.5rem", display: "inline-block" }} />
                  </label>
                  {dirty && (
                    <>
                      <button onClick={() => saveClip(c.index)} disabled={busy !== null}
                        style={{ background: CRIMSON, color: "#fff", border: "none", fontFamily: FONT, fontSize: "0.8rem", padding: "0.4rem 1rem", cursor: "pointer" }}>
                        {busy === `clip${c.index}` ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setClipDrafts(cd => { const n = { ...cd }; delete n[c.index]; return n; })}
                        style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, fontFamily: FONT, fontSize: "0.8rem", padding: "0.4rem 1rem", cursor: "pointer" }}>
                        Discard
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: MUTED, marginBottom: "0.7rem" }}>
          Transcript lines ({lines.length})
        </div>
        {loadError && <div style={{ color: CRIMSON, fontSize: "0.9rem" }}>{loadError}</div>}
        <div style={{ display: "grid", gap: "0.8rem" }}>
          {lines.map(l => {
            const draft = drafts[l.index];
            const dirty = draft !== undefined && draft !== l.text;
            return (
              <div key={l.index} style={{ background: "#fff", border: `1px solid ${BORDER}`, padding: "0.8rem 0.9rem" }}>
                <div style={{ display: "flex", gap: "0.7rem", alignItems: "baseline", marginBottom: "0.45rem" }}>
                  {l.speaker && <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: ".12em", color: CRIMSON }}>{l.speaker.toUpperCase()}</span>}
                  {l.timecode && <span style={{ fontSize: "0.72rem", color: MUTED }}>{l.timecode}</span>}
                  {!l.speaker && !l.timecode && <span style={{ fontSize: "0.72rem", color: MUTED, fontStyle: "italic" }}>narration</span>}
                </div>
                <textarea
                  value={draft ?? l.text}
                  onChange={e => setDrafts(d => ({ ...d, [l.index]: e.target.value }))}
                  rows={Math.max(2, Math.ceil((draft ?? l.text).length / 70))}
                  style={{ ...input, resize: "vertical", lineHeight: 1.5 }}
                />
                {dirty && (
                  <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.55rem" }}>
                    <button onClick={() => saveLine(l.index)} disabled={busy !== null}
                      style={{ background: CRIMSON, color: "#fff", border: "none", fontFamily: FONT, fontSize: "0.8rem", padding: "0.4rem 1rem", cursor: "pointer" }}>
                      {busy === l.index ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setDrafts(d => { const n = { ...d }; delete n[l.index]; return n; })}
                      style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, fontFamily: FONT, fontSize: "0.8rem", padding: "0.4rem 1rem", cursor: "pointer" }}>
                      Discard
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
