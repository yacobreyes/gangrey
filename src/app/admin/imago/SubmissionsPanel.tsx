"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";
import { getSubmissions, setSubmissionStatus, respondToSubmission, deleteSubmission, createStoryFromSubmission } from "../submissionActions";
import type { SubmissionRow, SubmissionStatus } from "@/lib/storage/sqlite";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF = "var(--font-cormorant), Georgia, serif";

const TABS: { key: SubmissionStatus | "all"; label: string }[] = [
  { key: "new", label: "New" },
  { key: "reading", label: "Reading" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
  { key: "all", label: "All" },
];

const STATUS_COLOR: Record<SubmissionStatus, string> = {
  new: CRIMSON, reading: "#392a22", accepted: "#1a7f37", declined: "#8a8a8c",
};

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const DEFAULT_ACCEPT = "We'd love to publish this in Gangrey. I'll follow up shortly with next steps on edits and scheduling.\n\nThank you for sending it our way.";
const DEFAULT_DECLINE = "Thank you for sending this to Gangrey. It isn't a fit for us right now, but we're grateful you thought of us, and we hope you'll try us again.";

export default function SubmissionsPanel() {
  const [subs, setSubs] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<SubmissionStatus | "all">("new");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getSubmissions().then(rows => setSubs(rows)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { new: 0, reading: 0, accepted: 0, declined: 0, all: subs.length };
    for (const s of subs) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [subs]);

  // Keep the currently-open card visible even if a status change (e.g. "Start
  // reading") moves it out of the active tab's filter — otherwise the card you
  // were mid-read on vanishes out from under you the moment you click a status
  // button. It naturally drops away once you close it or switch tabs.
  const shown = useMemo(
    () => (tab === "all" ? subs : subs.filter(s => s.status === tab || s._id === openId)),
    [subs, tab, openId]
  );

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 0 3rem" }}>
      <div style={{ margin: "0 0 0.5rem" }}>
        <h2 style={{ fontFamily: FONT, fontSize: "1.15rem", fontWeight: 700, color: TEXT_DARK, margin: 0 }}>Submissions</h2>
        <p style={{ fontFamily: FONT, fontSize: "0.82rem", color: TEXT_MUTED, margin: "0.25rem 0 0" }}>Stories sent in through the submission portal.</p>
      </div>

      {/* Status tabs — scrolls horizontally instead of wrapping, so "All"
          never drops to its own line on a narrow screen. */}
      <div style={{ display: "flex", gap: "0.25rem", borderBottom: `1px solid ${BORDER}`, margin: "1.25rem 0 0", overflowX: "auto", whiteSpace: "nowrap" }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setOpenId(null); }}
              style={{ background: "none", border: "none", borderBottom: `2px solid ${active ? CRIMSON : "transparent"}`, padding: "0.5rem 0.9rem", fontFamily: FONT, fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: active ? CRIMSON : TEXT_MUTED, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
              {t.label} <span style={{ color: active ? CRIMSON : "#b8b8ba", fontWeight: 600 }}>{counts[t.key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, margin: "2rem 0" }}>Loading…</p>
      ) : shown.length === 0 ? (
        <p style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: "1rem", color: TEXT_MUTED, margin: "2rem 0" }}>Nothing here yet.</p>
      ) : (
        <div style={{ margin: "1rem 0 0", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {shown.map(s => (
            <SubmissionCard key={s._id} sub={s} open={openId === s._id} onToggle={() => setOpenId(openId === s._id ? null : s._id)} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({ sub, open, onToggle, onChanged }: { sub: SubmissionRow; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const [compose, setCompose] = useState<null | "accepted" | "declined">(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  async function copyStory() {
    // Include a title + byline header so it pastes cleanly into a Google Doc.
    const payload = `${sub.title}\nBy ${sub.name} · ${sub.category}\n\n${sub.text}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — no-op */ }
  }

  async function createStory() {
    setCreating(true); setErr("");
    // Open the tab synchronously (still inside the click gesture) so the browser
    // doesn't block it as a pop-up once the await resolves; point it at the draft
    // when the server action returns.
    const w = window.open("about:blank", "_blank");
    const res = await createStoryFromSubmission(sub._id).catch(() => ({ ok: false, error: "Something went wrong." } as { ok: boolean; slug?: string; error?: string }));
    setCreating(false);
    if (res.ok && res.slug) {
      const url = `/admin/imago/posts/${res.slug}`;
      if (w && !w.closed) w.location.href = url;
      else window.location.href = url;
      onChanged();
    } else {
      w?.close();
      setErr(res.error || "Couldn't create the draft.");
    }
  }

  async function mark(status: "new" | "reading") {
    setBusy(true);
    await setSubmissionStatus(sub._id, status).catch(() => {});
    setBusy(false); onChanged();
  }

  function openCompose(decision: "accepted" | "declined") {
    setCompose(decision);
    setMessage(decision === "accepted" ? DEFAULT_ACCEPT : DEFAULT_DECLINE);
    setErr("");
  }

  async function send() {
    if (!compose) return;
    setBusy(true); setErr("");
    const res = await respondToSubmission(sub._id, compose, message).catch(() => ({ ok: false, error: "Something went wrong." }));
    setBusy(false);
    if (res.ok) { setCompose(null); onChanged(); }
    else setErr(res.error || "Couldn't send.");
  }

  async function remove() {
    if (!confirm(`Delete "${sub.title}" from ${sub.name}? This can't be undone.`)) return;
    setBusy(true);
    await deleteSubmission(sub._id).catch(() => {});
    setBusy(false); onChanged();
  }

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, background: "#fff", overflow: "hidden" }}>
      {/* Header row */}
      <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: "0.9rem", width: "100%", textAlign: "left", background: "none", border: "none", padding: "0.9rem 1.1rem", cursor: "pointer" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[sub.status], flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: SERIF, fontSize: "1.1rem", fontWeight: 700, color: TEXT_DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub.title}</span>
          <span style={{ display: "block", fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED, marginTop: 1 }}>{sub.name} · {sub.category} · {sub.wordCount.toLocaleString()} words</span>
        </span>
        <span style={{ fontFamily: FONT, fontSize: "0.72rem", color: "#b8b8ba", whiteSpace: "nowrap" }}>{fmtDate(sub._createdAt)}</span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: "1.1rem 1.1rem 1.25rem" }}>
          {/* Meta */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 1.25rem", fontFamily: FONT, fontSize: "0.8rem", color: TEXT_MUTED, marginBottom: "1rem" }}>
            <span><a href={`mailto:${sub.email}`} style={{ color: CRIMSON, textDecoration: "none" }}>{sub.email}</a></span>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, color: STATUS_COLOR[sub.status] }}>{sub.status}{sub.respondedAt ? ` · replied ${fmtDate(sub.respondedAt)}` : ""}</span>
          </div>

          {sub.coverLetter && (
            <div style={{ marginBottom: "1.1rem" }}>
              <div style={{ fontFamily: FONT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: CRIMSON, marginBottom: "0.4rem" }}>Cover letter</div>
              <p style={{ fontFamily: SERIF, fontSize: "0.98rem", lineHeight: 1.6, color: "#392a22", margin: 0, whiteSpace: "pre-line" }}>{sub.coverLetter}</p>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
            <span style={{ fontFamily: FONT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: CRIMSON }}>The story</span>
            <button onClick={copyStory} title="Copy the full story to paste into a Google Doc"
              style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "0.2rem 0.5rem", fontFamily: FONT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", color: copied ? "#1a7f37" : TEXT_MUTED, cursor: "pointer" }}>
              {copied ? (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
              ) : (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
              )}
            </button>
          </div>
          <div style={{ fontFamily: SERIF, fontSize: "1.05rem", lineHeight: 1.72, color: "#000", whiteSpace: "pre-wrap", maxHeight: 460, overflowY: "auto", padding: "0.5rem 0.9rem", background: "#faf9f7", border: `1px solid ${BORDER}`, borderRadius: 4 }}>
            {sub.text}
          </div>

          {/* Reply composer */}
          {compose ? (
            <div style={{ marginTop: "1.25rem", background: "#f6f4f1", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "1rem" }}>
              <div style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: compose === "accepted" ? "#1a7f37" : TEXT_MUTED, marginBottom: "0.5rem" }}>
                {compose === "accepted" ? "Accept" : "Decline"} — email to {sub.name}
              </div>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={6}
                style={{ width: "100%", boxSizing: "border-box", fontFamily: SERIF, fontSize: "0.98rem", lineHeight: 1.55, padding: "0.7rem 0.8rem", border: `1px solid ${BORDER}`, borderRadius: 4, outline: "none", resize: "vertical", color: "#000" }} />
              {err && <p style={{ fontFamily: FONT, fontSize: "0.78rem", color: CRIMSON, margin: "0.5rem 0 0" }}>{err}</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
                <button onClick={send} disabled={busy} style={btn(compose === "accepted" ? "#1a7f37" : CRIMSON, true, busy)}>{busy ? "Sending…" : `Send ${compose === "accepted" ? "acceptance" : "decline"}`}</button>
                <button onClick={() => setCompose(null)} disabled={busy} style={btn(TEXT_MUTED, false, busy)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: "1.25rem" }}>
              {/* Primary actions — their own row so they wrap predictably on
                  narrow screens instead of fighting Delete for space. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                {sub.status !== "reading" && sub.status !== "accepted" && sub.status !== "declined" && (
                  <button onClick={() => mark("reading")} disabled={busy} style={btn(TEXT_DARK, false, busy)}>Start reading</button>
                )}
                {sub.status === "reading" && (
                  <button onClick={() => mark("new")} disabled={busy} style={btn(TEXT_MUTED, false, busy)}>Back to new</button>
                )}
                <button onClick={() => openCompose("accepted")} disabled={busy} style={btn("#1a7f37", true, busy)}>Accept</button>
                <button onClick={() => openCompose("declined")} disabled={busy} style={btn(CRIMSON, false, busy)}>Decline</button>
                {sub.status === "accepted" && (
                  <button onClick={createStory} disabled={busy || creating} style={btn(TEXT_DARK, false, busy || creating)}>{creating ? "Creating…" : "Create story draft →"}</button>
                )}
              </div>
              {/* Delete — always its own row, so it never ends up stranded
                  alone at a wrapped edge (what marginLeft:auto did on mobile). */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.6rem", paddingTop: "0.6rem", borderTop: `1px solid ${BORDER}` }}>
                <button onClick={remove} disabled={busy} style={{ ...btn(CRIMSON, false, busy), color: TEXT_MUTED }}>Delete</button>
              </div>
              {err && <p style={{ fontFamily: FONT, fontSize: "0.78rem", color: CRIMSON, margin: "0.5rem 0 0" }}>{err}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function btn(color: string, filled: boolean, busy: boolean): React.CSSProperties {
  return {
    fontFamily: FONT, fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.04em",
    padding: "0.5rem 1rem", borderRadius: 4, cursor: busy ? "default" : "pointer",
    border: `1px solid ${color}`,
    background: filled ? color : "#fff",
    color: filled ? "#fff" : color,
    opacity: busy ? 0.6 : 1,
  };
}
