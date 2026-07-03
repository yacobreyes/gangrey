import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/sanity";
import { postReadingTime } from "@/lib/readingTime";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import StoryRowList from "@/components/StoryRowList";
import ListingHeader from "@/components/ListingHeader";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Gangrey | Life, in Brief.",
  description: "Short reads, sized to your window. One-, three-, and five-minute stories from Gangrey.",
};

const BUCKETS = [
  { read: 1, label: "One-Minute Reads", match: (t: number) => t <= 1 },
  { read: 3, label: "Three-Minute Reads", match: (t: number) => t >= 2 && t <= 3 },
  { read: 5, label: "Five-Minute Reads", match: (t: number) => t >= 4 },
] as const;

// Pre-render the three valid buckets as static paths.
export function generateStaticParams() {
  return BUCKETS.map(b => ({ read: String(b.read) }));
}

export default async function BriefReadPage({ params }: { params: Promise<{ read: string }> }) {
  const { read } = await params;
  const active = BUCKETS.find(b => String(b.read) === read) ?? BUCKETS[0];

  let posts = [] as Awaited<ReturnType<typeof getAllPosts>>;
  try { posts = await getAllPosts(); } catch {}
  const published = posts.filter(p =>
    (!p.status || p.status === "published" ||
    (p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt) <= new Date())) &&
    p.section !== "Archive"
  );
  const matches = published.filter(p => active.match(postReadingTime(p)));

  return (
    <div className="listing-page">
      <style>{`
        .listing-page { min-height: 100vh; display: flex; flex-direction: column; background: #ffffff; color: #000000; }
        .listing-main { width: 100%; max-width: 1180px; margin: 0 auto; padding: 20px 44px 60px; box-sizing: border-box; flex: 1; }
        .brief-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 36px; }
        .brief-tab {
          font-family: var(--font-subhead);
          font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
          padding: 10px 22px; border-radius: 2px; text-decoration: none;
          border: 1px solid #b8b8ba; color: #000000; transition: all .15s;
        }
        .brief-tab:hover { border-color: #490000; color: #490000; }
        .brief-tab.active { background: #490000; border-color: #490000; color: #ffffff; }
        .listing-empty { font-family: var(--font-headline); font-size: 22px; font-style: italic; color: #000000; margin-top: 24px; }
        @media (max-width: 900px) { .listing-main { padding: 20px 24px 64px; } }
      `}</style>
      <MagHeader />
      <main className="listing-main">
        <ListingHeader
          kicker="Life, in Brief"
          title={active.label}
          borderWidth={3}
          marginBottom={34}
        />
        <div className="brief-tabs">
          {BUCKETS.map(b => (
            <Link
              key={b.read}
              href={`/brief/${b.read}`}
              className={`brief-tab${b.read === active.read ? " active" : ""}`}
            >
              {b.read} Min
            </Link>
          ))}
        </div>
        {matches.length > 0
          ? <StoryRowList posts={matches} />
          : <p className="listing-empty">No {active.label.toLowerCase()} yet — check back soon.</p>}
      </main>
      <MagFooter />
    </div>
  );
}
