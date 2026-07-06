import type { Metadata } from "next";
import { getArchivePosts } from "@/lib/sanity";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import GangreyArchive from "@/components/GangreyArchive";
import ListingHeader from "@/components/ListingHeader";
import { normalizeHeadline } from "@/lib/gangreyDedup";

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

  // Deduplicate by normalized headline — keep the entry with a byline, else the first seen.
  const seen = new Map<string, typeof gangrey[number]>();
  for (const p of gangrey) {
    const key = normalizeHeadline(p.headline);
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev || (!prev.byline && p.byline)) seen.set(key, p);
  }
  const deduped = [...seen.values()].sort((a, b) => {
    const dt = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (dt !== 0) return dt;
    return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
  });

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
        <ListingHeader title="Archive" sub="Writing once featured on the original Gangrey blog." marginBottom={28} />
        {deduped.length === 0
          ? <p style={{ fontFamily: "var(--font-headline)", fontSize: 22, fontStyle: "italic", color: "#000000" }}>No stories yet.</p>
          : <GangreyArchive posts={deduped} />
        }
      </main>
      <MagFooter />
    </div>
  );
}
