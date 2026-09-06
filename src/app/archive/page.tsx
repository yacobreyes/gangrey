import type { Metadata } from "next";
import ArchivePageShell from "./ArchivePageShell";

// Per-request render: the DeLorean button inside is members-only, so this page
// reads the session cookie (which opts out of ISR anyway). The list itself is
// a light SQLite read — milliseconds.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Tampa Tribune | Archive",
  alternates: { canonical: "/archive" },
  description: "Writing once featured on the now-defunct Gangrey.com.",
};

export default async function GangreyPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  // ?q= seeds the search box, so a search is a shareable URL and the site's
  // SearchAction structured data points at something that really works.
  const q = ((await searchParams)?.q ?? "").slice(0, 120);
  return <ArchivePageShell q={q} />;
}
