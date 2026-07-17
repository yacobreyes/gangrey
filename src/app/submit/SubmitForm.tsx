"use client";

import { useState, useMemo } from "react";
import { WORD_LIMITS, SUBMISSION_CATEGORIES as CATEGORIES, countWords } from "@/lib/submissionValidation";

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
  // Honeypot — hidden from humans; only bots fill it. Server discards if set.
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const wordCount = useMemo(() => countWords(text), [text]);

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
        body: JSON.stringify({ name, email, title, category, coverLetter, text, website }),
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
          Thanks, {name.split(" ")[0] || "and welcome"}. Your story is in. We&apos;ve sent a confirmation to <strong>{email}</strong>. You&apos;ll hear back from us soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 620 }}>
      {/* Honeypot: off-screen, non-focusable, hidden from assistive tech. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
        value={website} onChange={e => setWebsite(e.target.value)}
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
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
          <label style={labelStyle} htmlFor="sub-title">Title of your story</label>
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
        <label style={labelStyle} htmlFor="sub-cover">Cover letter</label>
        <textarea id="sub-cover" style={{ ...inputStyle, minHeight: 90, resize: "vertical", lineHeight: 1.5 }} value={coverLetter} onChange={e => setCoverLetter(e.target.value)} required placeholder="A short note about you and the story. Publishing history welcome, not required." />
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <label style={labelStyle} htmlFor="sub-text">Your story</label>
          <span style={{ fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: overLimit ? 700 : 400, color: overLimit ? CRIMSON : wordCount ? "#392a22" : "#8a8a8c", fontVariantNumeric: "tabular-nums" }}>
            {wordCount.toLocaleString()}{limit != null ? ` / ${limit.toLocaleString()}` : ""} {limit != null ? "words" : wordCount === 1 ? "word" : "words"}
          </span>
        </div>
        <textarea id="sub-text" style={{ ...inputStyle, minHeight: 320, resize: "vertical", fontFamily: "var(--font-body)", fontSize: 16, lineHeight: 1.7 }} value={text} onChange={e => setText(e.target.value)} required placeholder="Paste your full story here." />
      </div>

      <div>
        <button type="submit" disabled={status === "loading" || overLimit}
          style={{ alignSelf: "flex-start", background: CRIMSON, color: "#fff", border: "none", borderRadius: 2, padding: "13px 28px", fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", cursor: (status === "loading" || overLimit) ? "not-allowed" : "pointer", opacity: (status === "loading" || overLimit) ? 0.5 : 1 }}>
          {status === "loading" ? "Submitting…" : overLimit ? `Over the ${limit!.toLocaleString()}-word limit` : "Submit your story"}
        </button>
        {status === "error" && <p style={{ fontFamily: "var(--font-subhead)", fontSize: 13, color: CRIMSON, margin: "12px 0 0" }}>{msg}</p>}
      </div>
    </form>
  );
}
