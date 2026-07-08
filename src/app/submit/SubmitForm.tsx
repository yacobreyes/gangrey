"use client";

import { useState, useMemo } from "react";

const WORD_LIMITS: Record<string, number> = {
  "Essay": 1000,
  "Reported Narrative": 400,
  "Micro-Memoir": 100,
};
const CATEGORIES = Object.keys(WORD_LIMITS);

const CRIMSON = "#490000";
const LINE = "#b8b8ba";

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-subhead)", fontSize: 11, fontWeight: 800,
  letterSpacing: ".14em", textTransform: "uppercase", color: "#392a22",
  display: "block", marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-subhead)", fontSize: 15, padding: "11px 13px",
  border: `1px solid ${LINE}`, borderRadius: 2, outline: "none",
  color: "#000000", width: "100%", boxSizing: "border-box", background: "#ffffff",
};

export default function SubmitForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("");
  const [coverLetter, setCoverLetter] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const wordCount = useMemo(() => {
    const t = text.trim();
    return t ? t.split(/\s+/).length : 0;
  }, [text]);

  const limit = category ? WORD_LIMITS[category] : null;
  const overLimit = limit != null && wordCount > limit;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    if (overLimit) {
      setStatus("error");
      setMsg(`${category}s must be ${limit!.toLocaleString()} words or fewer. Yours is ${wordCount.toLocaleString()}.`);
      return;
    }
    setStatus("loading"); setMsg("");
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, title, category, coverLetter, text }),
      });
      const data = await res.json();
      if (res.ok) setStatus("sent");
      else { setStatus("error"); setMsg(data.error || "Something went wrong."); }
    } catch {
      setStatus("error"); setMsg("Something went wrong. Try again.");
    }
  }

  if (status === "sent") {
    return (
      <div style={{ background: "#f4f4f5", padding: "26px 24px", borderRadius: 4, maxWidth: 620 }}>
        <div style={{ fontFamily: "var(--font-subhead)", fontSize: 11, fontWeight: 800, letterSpacing: ".18em", textTransform: "uppercase", color: CRIMSON, marginBottom: 8 }}>
          Received
        </div>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 17, lineHeight: 1.55, color: "#000000", margin: 0 }}>
          Thanks, {name.split(" ")[0] || "and welcome"}. Your piece is in. We sent a confirmation to <strong>{email}</strong>, and every submission is read by an editor. We'll reply either way.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 620 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={labelStyle} htmlFor="sub-name">Your name</label>
          <input id="sub-name" style={inputStyle} value={name} onChange={e => setName(e.target.value)} required autoComplete="name" />
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <label style={labelStyle} htmlFor="sub-email">Email</label>
          <input id="sub-email" type="email" style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@email.com" />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 260px" }}>
          <label style={labelStyle} htmlFor="sub-title">Title of your piece</label>
          <input id="sub-title" style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} required />
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label style={labelStyle} htmlFor="sub-cat">Category</label>
          <select id="sub-cat" style={{ ...inputStyle, appearance: "auto" }} value={category} onChange={e => setCategory(e.target.value)} required>
            <option value="" disabled>Choose one…</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label style={labelStyle} htmlFor="sub-cover">Cover letter <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#8a8a8c" }}>(optional)</span></label>
        <textarea id="sub-cover" style={{ ...inputStyle, minHeight: 90, resize: "vertical", lineHeight: 1.5 }} value={coverLetter} onChange={e => setCoverLetter(e.target.value)} placeholder="A short note about you and the piece. Publishing history welcome, not required." />
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <label style={labelStyle} htmlFor="sub-text">Your piece</label>
          <span style={{ fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: overLimit ? 700 : 400, color: overLimit ? CRIMSON : wordCount ? "#392a22" : "#8a8a8c", fontVariantNumeric: "tabular-nums" }}>
            {wordCount.toLocaleString()}{limit != null ? ` / ${limit.toLocaleString()}` : ""} {limit != null ? "words" : wordCount === 1 ? "word" : "words"}
          </span>
        </div>
        <textarea id="sub-text" style={{ ...inputStyle, minHeight: 320, resize: "vertical", fontFamily: "var(--font-body)", fontSize: 16, lineHeight: 1.7 }} value={text} onChange={e => setText(e.target.value)} required placeholder="Paste your full piece here." />
      </div>

      <div>
        <button type="submit" disabled={status === "loading" || overLimit}
          style={{ alignSelf: "flex-start", background: CRIMSON, color: "#fff", border: "none", borderRadius: 2, padding: "13px 28px", fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", cursor: (status === "loading" || overLimit) ? "not-allowed" : "pointer", opacity: (status === "loading" || overLimit) ? 0.5 : 1 }}>
          {status === "loading" ? "Submitting…" : overLimit ? `Over the ${limit!.toLocaleString()}-word limit` : "Submit your piece"}
        </button>
        {status === "error" && <p style={{ fontFamily: "var(--font-subhead)", fontSize: 13, color: CRIMSON, margin: "12px 0 0" }}>{msg}</p>}
      </div>
    </form>
  );
}
