"use client";
import { useEffect } from "react";

// Records a metered (non-member) read once, after the page renders — so the
// paywall meter counts real reads, not crawler/prefetch hits.
export default function MeterPing({ slug }: { slug: string }) {
  useEffect(() => {
    fetch("/api/meter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }), keepalive: true }).catch(() => {});
  }, [slug]);
  return null;
}
