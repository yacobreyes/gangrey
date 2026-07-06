"use client";

import { useEffect, useRef } from "react";

// Fires a single view-count POST per story load. Deduped within a browser
// session (sessionStorage) so a reload in the same tab doesn't double-count.
export default function StoryVisitTracker({ slug }: { slug: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !slug) return;
    sent.current = true;
    const key = `gangrey_viewed_${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
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
