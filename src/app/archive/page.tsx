import type { Metadata } from "next";
import { getArchivePosts } from "@/lib/sanity";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import GangreyArchive from "@/components/GangreyArchive";
import ListingHeader from "@/components/ListingHeader";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Gangrey | Archive",
  alternates: { canonical: "/archive" },
  description: "Writing once featured on the now-defunct Gangrey.com.",
};

export default async function GangreyPage() {
  let gangrey = [] as Awaited<ReturnType<typeof getArchivePosts>>;
  try { gangrey = await getArchivePosts(); } catch {}

  gangrey = gangrey
    .sort((a, b) => {
      const dt = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dt !== 0) return dt;
      return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
    });

  // No dedupe: the archive is rebuilt from the month-by-month Wayback crawl,
  // which guarantees unique posts at the source (and keeps genuine reposts
  // like "Eating Jack Hooker's Cow", June 2005 + May 2010). The old
  // headline-dedupe existed for the first import's slug-variant duplicates.
  const deduped = gangrey;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <style>{`
        .gr-wrap { width: 100%; max-width: 1290px; margin: 0 auto; padding: 20px 32px 60px; box-sizing: border-box; flex: 1; }
        @media (max-width: 900px) {
          .gr-wrap { padding: 20px 20px 64px; }
        }
      `}</style>
      <MagHeader />
      <main className="gr-wrap">
        <ListingHeader title="Archive" sub="Writing once featured on the original Gangrey blog." marginBottom={12} />
        {/* Time machine: the full static mirror of the old gangrey.com,
            rebuilt from the Wayback Machine and served at /delorean. */}
        <p style={{ margin: "0 0 28px" }}>
          <a href="/delorean/" style={{ display: "inline-block", fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 800, letterSpacing: ".18em", textTransform: "uppercase", color: "#490000", border: "1px solid #490000", padding: "8px 14px", textDecoration: "none" }}>
            Browse the original site (2005–2016) →
          </a>
        </p>
        {deduped.length === 0
          ? <p style={{ fontFamily: "var(--font-headline)", fontSize: 22, fontStyle: "italic", color: "#000000" }}>No stories yet.</p>
          : <GangreyArchive posts={deduped} />
        }
      </main>
      <MagFooter />
    </div>
  );
}
