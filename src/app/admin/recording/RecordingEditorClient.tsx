"use client";

import { useState } from "react";
import type { RecordingLine } from "@/lib/recordingStore";
import { updateRecordingLine, recordingFindReplace, recordingReset, getRecordingLines } from "../recordingActions";

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const CRIMSON = "#490000";
const BORDER = "#d8d3c8";
const MUTED = "#6f6a60";

export default function RecordingEditorClient({ initialLines, loadError }: {
  initialLines: RecordingLine[];
  loadError: string | null;
}) {
  const [lines, setLines] = useState(initialLines);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | "fr" | "reset" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");

  async function refresh() {
    try { setLines(await getRecordingLines()); setDrafts({}); } catch { /* keep current */ }
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
