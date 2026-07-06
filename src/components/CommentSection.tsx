"use client";

import { useEffect, useRef, useState } from "react";
import { straightenQuotes } from "@/lib/straighten";

interface Comment { _id: string; name: string; text: string; _createdAt: string; }

export default function CommentSection({ slug }: { slug: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { const n = localStorage.getItem("efemera_commenter_name"); if (n) setName(n); } catch {}
    fetch(`/api/comments?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setComments(d); })
      .catch(() => {});
  }, [slug]);

  async function submit() {
    if (!text.trim() || !name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name: straightenQuotes(name.trim()), text: straightenQuotes(text.trim()) }),
      });
      if (res.ok) {
        try { localStorage.setItem("efemera_commenter_name", name.trim()); } catch {}
        setText("");
        setSubmitted(true);
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
          <p style={{ fontFamily: "var(--font-subhead)", fontSize: "0.9rem", color: "#392a22" }}>Thanks! Your comment will appear once it&apos;s approved.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <input
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ ...S, width: "100%" }}
            />
            <textarea
              ref={textRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="What did this bring up for you? (Enter to post)"
              rows={3}
              style={{ ...S, width: "100%", resize: "vertical", lineHeight: 1.6 }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={submit}
                disabled={!name.trim() || !text.trim() || submitting}
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
