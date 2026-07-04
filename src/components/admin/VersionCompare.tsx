"use client";

import { redlineParagraphs } from "@/lib/editorDiff";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "var(--font-inter), sans-serif";

// Google-Docs-style version compare: the document rendered as one flowing
// redline — unchanged text plain, additions highlighted green, deletions struck
// through red — with a Restore action. `oldLines`/`newLines` are the paragraph
// strings of the saved version and the current draft (headline first).
export default function VersionCompare({
  label, oldLines, newLines, onRestore, onClose, isMobile = false,
}: {
  label: string;
  oldLines: string[];
  newLines: string[];
  onRestore: () => void;
  onClose: () => void;
  isMobile?: boolean;
}) {
  const paras = redlineParagraphs(oldLines, newLines);
  const changes = paras.filter(p => p.changed).length;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 0 : "2rem" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: isMobile ? 0 : 10, width: isMobile ? "100vw" : "min(760px, 96vw)", height: isMobile ? "100dvh" : "min(720px, 92vh)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "1rem 1.5rem", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", margin: 0, color: TEXT_DARK }}>Version history</p>
            <p style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, margin: "0.2rem 0 0" }}>
              Changes from {label} to now · {changes === 0 ? "no differences" : `${changes} paragraph${changes === 1 ? "" : "s"} changed`}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
            <button type="button" onClick={onRestore}
              style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.4rem 1rem", fontFamily: FONT, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              Restore this version
            </button>
            <button type="button" onClick={onClose}
              style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.4rem 0.9rem", fontFamily: FONT, fontSize: "0.8rem", cursor: "pointer", color: TEXT_MUTED }}>
              Close
            </button>
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "1.25rem", padding: "0.5rem 1.5rem", borderBottom: `1px solid ${BORDER}`, fontFamily: FONT, fontSize: "0.72rem", color: TEXT_MUTED, flexShrink: 0 }}>
          <span><span style={{ background: "#e9f7ec", color: "#1a5a2a", padding: "0 4px", borderRadius: 2 }}>added</span></span>
          <span><span style={{ background: "#fdecec", color: "#7a1a1a", textDecoration: "line-through", padding: "0 4px", borderRadius: 2 }}>removed</span></span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "1.25rem 1.25rem 3rem" : "1.75rem 2.25rem 3rem" }}>
          {paras.length === 0 ? (
            <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>This version is empty.</p>
          ) : paras.map((p, pi) => (
            <p key={p.key} style={{ fontFamily: "Georgia, serif", fontSize: "1.02rem", lineHeight: 1.7, color: TEXT_DARK, margin: pi === 0 ? "0 0 1.1rem" : "0 0 1.1rem", fontWeight: pi === 0 ? 700 : 400 }}>
              {p.runs.map((r, i) => r.type === "same"
                ? <span key={i}>{r.text}</span>
                : r.type === "add"
                  ? <span key={i} style={{ background: "#e9f7ec", color: "#1a5a2a", borderRadius: 2 }}>{r.text}</span>
                  : <span key={i} style={{ background: "#fdecec", color: "#7a1a1a", textDecoration: "line-through", borderRadius: 2 }}>{r.text}</span>
              )}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
