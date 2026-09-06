"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";

function UnsubscribeForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center" }}>
      <h1 style={{ fontFamily: 'var(--font-headline)', fontSize: 36, lineHeight: 1.1, color: "#000000", margin: "0 0 12px" }}>
        Unsubscribe
      </h1>
      {status === "done" ? (
        <p style={{ fontFamily: 'var(--font-headline)', fontSize: 19, lineHeight: 1.5, color: "#000000" }}>
          You&#39;ve been unsubscribed. You won&#39;t receive any more emails from The Tampa Tribune.
        </p>
      ) : (
        <>
          <p style={{ fontFamily: 'var(--font-headline)', fontSize: 19, fontStyle: "italic", lineHeight: 1.5, color: "#000000", margin: "0 0 28px" }}>
            Enter your email to stop receiving our newsletter.
          </p>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 15, padding: "12px 14px", border: "1px solid #b8b8ba", borderRadius: 2, outline: "none", background: "#fff", color: "#000000" }}
            />
            <button
              type="submit"
              disabled={status === "loading"}
              style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#fff", background: "#490000", border: "none", padding: "12px 14px", borderRadius: 2, cursor: status === "loading" ? "default" : "pointer", opacity: status === "loading" ? 0.7 : 1 }}
            >
              {status === "loading" ? "Unsubscribing…" : "Unsubscribe"}
            </button>
            {status === "error" && (
              <p style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 13, color: "#490000", margin: 0 }}>{error}</p>
            )}
          </form>
        </>
      )}
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff" }}>
      <MagHeader />
      <main style={{ flex: 1 }}>
        <Suspense fallback={null}>
          <UnsubscribeForm />
        </Suspense>
      </main>
      <MagFooter />
    </div>
  );
}
