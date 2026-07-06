"use client";

import { useEffect, useRef } from "react";

// Records one view per story per device per 24h. localStorage keeps a
// timestamp per slug; within the window, repeat opens/reloads from the same
// phone/browser don't re-count. (Clearing storage or private mode resets it —
// that's the accepted tradeoff every cookieless counter makes.)
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export default function StoryVisitTracker({ slug }: { slug: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !slug) return;
    sent.current = true;
    const key = `gangrey_viewed_${slug}`;
    try {
      const last = Number(localStorage.getItem(key) ?? 0);
      if (Date.now() - last < DEDUP_WINDOW_MS) return;
      localStorage.setItem(key, String(Date.now()));
    } catch { /* private mode — count anyway */ }
    fetch("/api/track-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => {});
  }, [slug]);
  return null;
}
