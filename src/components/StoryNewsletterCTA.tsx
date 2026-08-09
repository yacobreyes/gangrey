"use client";

import { useState } from "react";

// End-of-story email capture. The site had no newsletter signup on any page a
// reader actually reads: the only ask was the paywall, which non-members see
// only when they hit a gated story. This catches the other moment, the one
// with the most intent, right after someone finishes a piece.
//
// Shown to everyone except active members, and never alongside the paywall
// (that already makes its own, stronger ask).
export default function StoryNewsletterCTA() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading"); setMessage("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setStatus("done"); setEmail(""); }
      else { setStatus("error"); setMessage(data.error || "Something went wrong. Try again."); }
    } catch {
      setStatus("error"); setMessage("Something went wrong. Try again.");
    }
  }

  return (
    <aside className="story-nl">
      <style>{`
        .story-nl {
          width: 100%; max-width: 680px; margin: 0 auto;
          padding: 0 40px 8px; box-sizing: border-box;
        }
        .story-nl-inner {
          border-top: 1px solid #b8b8ba;
          border-bottom: 1px solid #b8b8ba;
          padding: 24px 0;
        }
        .story-nl-kicker {
          font-family: var(--font-subhead);
          font-size: 11px; font-weight: 800; letter-spacing: .18em;
          text-transform: uppercase; color: #490000; margin: 0 0 8px;
        }
        .story-nl-title {
          font-family: var(--font-headline);
          font-size: clamp(21px, 3.2vw, 26px); font-weight: 800;
          letter-spacing: -.02em; line-height: 1.12; margin: 0 0 16px; color: #000000;
        }
        .story-nl-form { display: flex; gap: 8px; flex-wrap: wrap; }
        .story-nl-input {
          flex: 1 1 220px; min-width: 0; box-sizing: border-box;
          font-family: var(--font-subhead); font-size: 14px;
          padding: 0 12px; height: 44px;
          border: 1px solid #b8b8ba; border-radius: 2px;
          background: #ffffff; color: #000000; outline: none;
        }
        .story-nl-input:focus { border-color: #490000; }
        .story-nl-btn {
          height: 44px; padding: 0 22px; border: none; border-radius: 2px;
          background: #490000; color: #ffffff; cursor: pointer;
          font-family: var(--font-subhead); font-size: 12px; font-weight: 700;
          letter-spacing: .14em; text-transform: uppercase; white-space: nowrap;
        }
        .story-nl-btn:disabled { opacity: .6; cursor: default; }
        .story-nl-note {
          font-family: var(--font-subhead); font-size: 12px;
          color: #8a8a8c; margin: 10px 0 0;
        }
        .story-nl-err { color: #490000; }
        .story-nl-done {
          font-family: var(--font-headline); font-size: 19px; font-style: italic;
          color: #000000; margin: 0;
        }
        @media (max-width: 720px) {
          .story-nl { padding: 0 20px 8px; }
          .story-nl-btn { flex: 1 1 100%; }
        }
      `}</style>
      <div className="story-nl-inner">
        {status === "done" ? (
          <p className="story-nl-done">You are on the list. Thanks for reading.</p>
        ) : (
          <>
            <p className="story-nl-kicker">The Newsletter</p>
            <h2 className="story-nl-title">Get the next one in your inbox.</h2>
            <form className="story-nl-form" onSubmit={submit}>
              <input
                className="story-nl-input"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                aria-label="Your email address"
                autoComplete="email"
              />
              <button className="story-nl-btn" type="submit" disabled={status === "loading"}>
                {status === "loading" ? "Signing up…" : "Sign up"}
              </button>
            </form>
            {status === "error" && <p className="story-nl-note story-nl-err">{message}</p>}
          </>
        )}
      </div>
    </aside>
  );
}
