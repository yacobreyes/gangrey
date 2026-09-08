"use client";

import { useEffect, useRef, useState } from "react";
import { straightenQuotes } from "@/lib/straighten";

interface Comment { _id: string; name: string; text: string; _createdAt: string; }

export default function CommentSection({ slug }: { slug: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [text, setText] = useState("");
  // Honeypot — hidden from humans; only bots fill it. Submitted but discarded server-side.
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; text?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const n = localStorage.getItem("sunland_commenter_name"); if (n) setName(n);
      const em = localStorage.getItem("sunland_commenter_email"); if (em) setEmail(em);
    } catch {}
    fetch(`/api/comments?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setComments(d); })
      .catch(() => {});
  }, [slug]);

  function validate() {
    const next: { name?: string; email?: string; text?: string } = {};
    if (!name.trim()) next.name = "Name required";
    if (!email.trim()) next.email = "Email required";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = "Enter a valid email";
    if (!text.trim()) next.text = "Comment required";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name: straightenQuotes(name.trim()), email: email.trim(), text: straightenQuotes(text.trim()), website }),
      });
      if (res.ok) {
        try {
          localStorage.setItem("sunland_commenter_name", name.trim());
          localStorage.setItem("sunland_commenter_email", email.trim());
        } catch {}
        setText("");
        setSubmitted(true);
        // Comment is live immediately — refresh the list so they see it.
        const updated = await fetch(`/api/comments?slug=${encodeURIComponent(slug)}`).then(r => r.json());
        if (Array.isArray(updated)) setComments(updated);
        setTimeout(() => setSubmitted(false), 3000);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const S: React.CSSProperties = {
    fontFamily: "var(--font-subhead)",
    fontSize: "0.9rem",
    padding: "0.5rem 0.7rem",
    border: "1px solid #b8b8ba",
    borderRadius: 4,
    outline: "none",
    color: "#000000",
    background: "#ffffff",
    boxSizing: "border-box",
  };
  const ERR: React.CSSProperties = {
    fontFamily: "var(--font-subhead)", fontSize: "0.72rem", color: "#490000", margin: "0.25rem 0 0",
  };

  return (
    <section id="comments" style={{ width: "100%", maxWidth: 600, margin: "0 auto 3rem", padding: "0 0", scrollMarginTop: "4rem" }}>
      <div style={{ borderTop: "1px solid #b8b8ba", paddingTop: "1.5rem", marginTop: "0.5rem" }}>
        <h2 style={{ fontFamily: "var(--font-subhead)", fontWeight: 800, fontSize: "0.75rem", letterSpacing: ".2em", textTransform: "uppercase", color: "#000000", margin: "0 0 1.2rem" }}>
          {comments.length === 0 ? "Leave a comment" : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}
        </h2>

        {comments.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
            {comments.map(c => (
              <div key={c._id} style={{ background: "#ffffff", border: "1px solid #b8b8ba", borderRadius: 4, padding: "0.75rem 1rem" }}>
                <p style={{ fontFamily: "var(--font-subhead)", fontWeight: 600, fontSize: "0.78rem", color: "#490000", margin: "0 0 0.3rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{straightenQuotes(c.name)}</p>
                <p style={{ fontFamily: "var(--font-subhead)", fontSize: "0.95rem", lineHeight: 1.6, color: "#000000", margin: 0 }}>{straightenQuotes(c.text)}</p>
              </div>
            ))}
          </div>
        )}

        {submitted ? (
          <p style={{ fontFamily: "var(--font-subhead)", fontSize: "0.9rem", color: "#392a22" }}>Thanks — your comment is posted. You&apos;re now on The Sunland Tribune list, too.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {/* Honeypot: off-screen, non-focusable, hidden from assistive tech.
                Only bots fill it, and the server discards anything that does. */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
              value={website} onChange={e => setWebsite(e.target.value)}
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
              <div>
                <input
                  placeholder="Your name"
                  value={name}
                  onChange={e => { setName(e.target.value); if (errors.name) setErrors(x => ({ ...x, name: undefined })); }}
                  style={{ ...S, width: "100%", borderColor: errors.name ? "#490000" : "#b8b8ba" }}
                />
                {errors.name && <p style={ERR}>{errors.name}</p>}
              </div>
              <div>
                <input
                  type="email"
                  placeholder="Your email (not published)"
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (errors.email) setErrors(x => ({ ...x, email: undefined })); }}
                  style={{ ...S, width: "100%", borderColor: errors.email ? "#490000" : "#b8b8ba" }}
                />
                {errors.email && <p style={ERR}>{errors.email}</p>}
              </div>
            </div>
            <textarea
              ref={textRef}
              value={text}
              onChange={e => { setText(e.target.value); if (errors.text) setErrors(x => ({ ...x, text: undefined })); }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="What did this bring up for you? (Enter to post)"
              rows={3}
              style={{ ...S, width: "100%", resize: "vertical", lineHeight: 1.6, borderColor: errors.text ? "#490000" : "#b8b8ba" }}
            />
            {errors.text && <p style={{ ...ERR, marginTop: "-0.3rem" }}>{errors.text}</p>}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
              <p style={{ fontFamily: "var(--font-subhead)", fontSize: "0.75rem", color: "#8a8a8c", margin: 0 }}>
                Posting subscribes you to The Sunland Tribune newsletter. Unsubscribe anytime.
              </p>
              <button
                onClick={submit}
                disabled={submitting}
                style={{ fontFamily: "var(--font-subhead)", fontSize: "0.85rem", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#ffffff", background: "#490000", border: "none", borderRadius: 2, cursor: "pointer", padding: "0.5rem 1.2rem" }}>
                {submitting ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
