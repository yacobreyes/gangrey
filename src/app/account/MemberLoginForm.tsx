"use client";

import { useEffect, useState } from "react";

export default function MemberLoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState<"members_only" | "google_error" | null>(null);

  // Surface the result of a Google sign-in attempt (the callback redirects here
  // with a query flag) without needing a Suspense boundary.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("members_only")) setNotice("members_only");
    else if (p.get("error") === "google") setNotice("google_error");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading"); setMsg("");
    try {
      const res = await fetch("/api/member/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) { setStatus("sent"); }
      else { setStatus("error"); setMsg(data.error || "Something went wrong."); }
    } catch {
      setStatus("error"); setMsg("Something went wrong.");
    }
  }

  if (status === "sent") {
    return (
      <p style={{ fontFamily: "var(--font-body)", fontSize: 17, lineHeight: 1.5, color: "#392a22", margin: 0 }}>
        If that email has a Tampa Tribune membership, a sign-in link is on its way. Check your inbox.
      </p>
    );
  }

  const note: React.CSSProperties = { fontFamily: "var(--font-subhead)", fontSize: 13.5, lineHeight: 1.55, margin: "0 0 4px", maxWidth: 380 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 380 }}>
      {notice === "members_only" && (
        <p style={{ ...note, color: "#392a22" }}>
          That Google account is not a member yet. <a href="/subscribe" style={{ color: "#490000", fontWeight: 700 }}>Subscribe</a> to unlock the archive and member stories.
        </p>
      )}
      {notice === "google_error" && (
        <p style={{ ...note, color: "#490000" }}>Google sign-in did not go through. Try again, or use the email link below.</p>
      )}

      <a href="/api/member/google/start"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10, alignSelf: "flex-start", background: "#ffffff", color: "#000000", border: "1px solid #b8b8ba", borderRadius: 2, padding: "11px 20px", fontFamily: "var(--font-subhead)", fontSize: 14, fontWeight: 600, textDecoration: "none", cursor: "pointer" }}>
        <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        Continue with Google
      </a>

      <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 380 }}>
        <span style={{ flex: 1, height: 1, background: "#e2e0dd" }} />
        <span style={{ fontFamily: "var(--font-subhead)", fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#a29a93" }}>or</span>
        <span style={{ flex: 1, height: 1, background: "#e2e0dd" }} />
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <input
          type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@email.com" autoComplete="email" aria-label="Email address"
          style={{ fontFamily: "var(--font-subhead)", fontSize: 15, padding: "12px 14px", border: "1px solid #b8b8ba", borderRadius: 2, outline: "none", color: "#000000" }}
        />
        <button
          type="submit" disabled={status === "loading"}
          style={{ alignSelf: "flex-start", background: "#490000", color: "#fff", border: "none", borderRadius: 2, padding: "11px 22px", fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", cursor: "pointer", opacity: status === "loading" ? 0.6 : 1 }}
        >
          {status === "loading" ? "Sending" : "Email me a link"}
        </button>
        {status === "error" && <p style={{ fontFamily: "var(--font-subhead)", fontSize: 13, color: "#490000", margin: 0 }}>{msg}</p>}
      </form>
    </div>
  );
}
