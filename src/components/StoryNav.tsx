"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";

export default function StoryNav() {
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setSectionsOpen(false);
    }
    if (sectionsOpen) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [sectionsOpen]);

  const linkStyle = { fontFamily: "var(--font-subhead)", fontSize: "0.85rem", fontWeight: 700, color: "white", textDecoration: "none", letterSpacing: "0.05em" } as const;

  return (
    <nav className="story-nav">
      {(["Home", "About"] as const).map(s => (
        <Link key={s} href={s === "Home" ? "/" : `/?tab=${s}`} style={linkStyle}>{s}</Link>
      ))}
      <div ref={ref} style={{ position: "relative" }}>
        <button
          onClick={() => setSectionsOpen(v => !v)}
          style={{ ...linkStyle, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.3rem", padding: 0 }}>
          Sections
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ transition: "transform 0.15s", transform: sectionsOpen ? "rotate(180deg)" : "rotate(0deg)" }}><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {sectionsOpen && (
          <div style={{ position: "absolute", top: "calc(100% + 0.6rem)", right: 0, background: "white", border: "1px solid #b8b8ba", borderRadius: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 160, zIndex: 100, overflow: "hidden" }}>
            {(["Micro-Memoirs", "Narratives", "Essays"] as const).map(s => (
              <Link key={s} href={`/?tab=${s}`} onClick={() => setSectionsOpen(false)} style={{ display: "block", padding: "0.65rem 1rem", fontFamily: "var(--font-subhead)", fontSize: "0.88rem", fontWeight: 500, color: "#000000", textDecoration: "none", letterSpacing: "0.02em" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#ffffff")}
                onMouseLeave={e => (e.currentTarget.style.background = "white")}>
                {s}
              </Link>
            ))}
          </div>
        )}
      </div>
      <Link href="/archive" style={linkStyle}>Archive</Link>
    </nav>
  );
}
