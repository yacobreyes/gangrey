"use client";

import { useEffect, useRef, useState } from "react";

export default function LikeButton({ slug }: { slug: string }) {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(0);
  const pending = useRef(false);

  useEffect(() => {
    setLiked(localStorage.getItem(`sunland_liked_${slug}`) === "1");
    fetch(`/api/likes?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => { if (d.count !== undefined) setCount(d.count); })
      .catch(() => {});
  }, [slug]);

  async function toggle() {
    if (pending.current) return;
    pending.current = true;
    const newLiked = !liked;
    const delta = newLiked ? 1 : -1;
    setLiked(newLiked);
    setCount(c => c + delta);
    localStorage.setItem(`sunland_liked_${slug}`, newLiked ? "1" : "0");
    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, delta }),
      });
      const d = await res.json();
      if (d.count !== undefined) setCount(d.count);
    } catch {}
    pending.current = false;
  }

  return (
    <button
      onClick={toggle}
      style={{
        display: "flex", alignItems: "center", gap: "0.35rem",
        background: "none", border: "none",
        cursor: "pointer",
        padding: 0,
        color: liked ? "#490000" : "#000000",
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
      </svg>
      <span style={{ fontFamily: "var(--font-subhead)", fontSize: "0.8rem" }}>{count}</span>
    </button>
  );
}
