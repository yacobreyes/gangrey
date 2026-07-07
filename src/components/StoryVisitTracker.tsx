"use client";

import { useEffect, useRef } from "react";

// Analytics beacon: records one pageview per load and measures *engaged time*
// (active reading), flushing via sendBeacon. Cookieless — the session id is a
// random per-tab value in sessionStorage, no PII. Powers the Analytics engine.
//
// Engaged time counts only while the tab is visible AND the reader has interacted
// (scroll/mouse/key/touch) within the last IDLE_MS — so an open-but-abandoned tab
// doesn't inflate reading time, matching how Parse.ly measures "engaged time".

const HEARTBEAT_MS = 15_000; // flush cadence
const IDLE_MS = 30_000;      // no interaction for this long → not engaged

function sessionId(): string {
  try {
    let id = sessionStorage.getItem("gangrey_sid");
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("gangrey_sid", id); }
    return id;
  } catch { return "anon"; }
}

export default function StoryVisitTracker({ slug }: { slug: string }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !slug) return;
    started.current = true;
    const sid = sessionId();

    // Record the pageview (deduped per-tab-load via sessionStorage).
    const viewKey = `gangrey_v_${slug}`;
    let alreadyViewed = false;
    try { alreadyViewed = sessionStorage.getItem(viewKey) === "1"; sessionStorage.setItem(viewKey, "1"); } catch {}
    if (!alreadyViewed) {
      fetch("/api/track", {
        method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s: slug, k: "v", sid, r: document.referrer || "" }),
      }).catch(() => {});
    }

    // --- Engaged-time tracking ---
    let lastInteraction = Date.now();
    let accum = 0;            // engaged ms not yet flushed
    let lastTick = Date.now();
    const bump = () => { lastInteraction = Date.now(); };
    const engaged = () => document.visibilityState === "visible" && Date.now() - lastInteraction < IDLE_MS;

    const tick = () => {
      const now = Date.now();
      if (engaged()) accum += now - lastTick;
      lastTick = now;
    };
    const flush = (viaBeacon = false) => {
      tick();
      if (accum < 1000) return;
      const payload = JSON.stringify({ s: slug, k: "e", sid, ms: accum });
      accum = 0;
      if (viaBeacon && navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      } else {
        fetch("/api/track", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: payload }).catch(() => {});
      }
    };

    const interval = setInterval(() => flush(false), HEARTBEAT_MS);
    const acts = ["scroll", "mousemove", "keydown", "touchstart", "click"] as const;
    acts.forEach(a => window.addEventListener(a, bump, { passive: true }));
    const onHide = () => { if (document.visibilityState === "hidden") flush(true); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", () => flush(true));

    return () => {
      clearInterval(interval);
      acts.forEach(a => window.removeEventListener(a, bump));
      document.removeEventListener("visibilitychange", onHide);
      flush(true);
    };
  }, [slug]);

  return null;
}
