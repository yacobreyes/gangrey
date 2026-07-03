"use client";

import { useState } from "react";

export default function MemberLoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

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
        If that email has a Gangrey membership, a sign-in link is on its way. Check your inbox.
      </p>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 380 }}>
      <input
        type="email" required value={email} onChange={e => setEmail(e.target.value)}
        placeholder="you@email.com" autoComplete="email" aria-label="Email address"
        style={{ fontFamily: "var(--font-subhead)", fontSize: 15, padding: "12px 14px", border: "1px solid #b8b8ba", borderRadius: 2, outline: "none", color: "#000000" }}
      />
      <button
        type="submit" disabled={status === "loading"}
        style={{ alignSelf: "flex-start", background: "#490000", color: "#fff", border: "none", borderRadius: 2, padding: "11px 22px", fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", cursor: "pointer", opacity: status === "loading" ? 0.6 : 1 }}
      >
        {status === "loading" ? "Sending…" : "Email me a link"}
      </button>
      {status === "error" && <p style={{ fontFamily: "var(--font-subhead)", fontSize: 13, color: "#490000", margin: 0 }}>{msg}</p>}
    </form>
  );
}
