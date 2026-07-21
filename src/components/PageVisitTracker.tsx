"use client";

import { useEffect, useRef } from "react";

// Records a pageview for non-story pages (archive listing, homepage, sections).
// Sent with page:true so the server files it under a "page:" slug — it shows in
// Analytics' Top Pages, never Top Stories. Cookieless, one view per tab-load.
export default function PageVisitTracker({ label }: { label: string }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !label) return;
    started.current = true;

    let sid = "anon";
    try {
      sid = sessionStorage.getItem("gangrey_sid") ?? "";
      if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("gangrey_sid", sid); }
      const key = `gangrey_pv_${label}`;
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
    } catch {}

    fetch("/api/track", {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s: label, k: "v", page: true, sid, r: document.referrer || "" }),
    }).catch(() => {});
  }, [label]);

  return null;
}
