import type { Metadata } from "next";
import { getPostsLight } from "@/lib/sanity";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import StoryRowList from "@/components/StoryRowList";
import ListingHeader from "@/components/ListingHeader";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Gangrey | The Latest",
  alternates: { canonical: "/latest" },
  description: "The newest writing from Gangrey.",
};

export default async function LatestPage() {
  let posts = [] as Awaited<ReturnType<typeof getPostsLight>>;
  try { posts = await getPostsLight(); } catch {}
  const published = posts.filter(p =>
    (!p.status || p.status === "published" ||
    (p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt) <= new Date())) &&
    p.section !== "Archive"
  );

  return (
    <div className="listing-page">
      <style>{`
        .listing-page { min-height: 100vh; display: flex; flex-direction: column; background: #ffffff; color: #000000; }
        .listing-main { width: 100%; padding: 20px 76px 60px; box-sizing: border-box; flex: 1; }
        .listing-empty { font-family: var(--font-headline); font-size: 22px; font-style: italic; color: #000000; }
        @media (max-width: 900px) { .listing-main { padding: 20px 20px 64px; } }
      `}</style>
      <MagHeader />
      <main className="listing-main">
        <ListingHeader title="The Latest" sub="The newest voices and stories from Gangrey." marginBottom={36} />
        {published.length > 0
          ? <StoryRowList posts={published} />
          : <p className="listing-empty">No stories yet.</p>}
      </main>
      <MagFooter />
    </div>
  );
}
