import { getPostsLight } from "@/lib/content";
import StoryRowList from "@/components/StoryRowList";

// "Keep reading" at the foot of a story: up to three more pieces, preferring the
// same section, backfilled by recency — rendered as the same horizontal rows as
// The Latest page (StoryRowList).
export default async function RelatedStories({ slug, section }: { slug: string; section: string }) {
  let posts = await getPostsLight().catch(() => []);
  posts = posts.filter(
    p => p.slug !== slug &&
    p.section !== "Archive" &&
    (p.status === "published" || !p.status)
  );

  const byDate = (a: { date: string }, b: { date: string }) =>
    new Date(b.date).getTime() - new Date(a.date).getTime();

  const sameSection = posts.filter(p => p.section === section).sort(byDate);
  const others = posts.filter(p => p.section !== section).sort(byDate);
  const picks = [...sameSection, ...others].slice(0, 3);

  if (picks.length === 0) return null;

  return (
    <section className="rel-wrap">
      <style>{`
        .rel-wrap { width: 100%; max-width: 680px; margin: 0 auto; padding: 8px 40px 44px; box-sizing: border-box; }
        .rel-rule { border-top: 1px dotted #8a8a8c; margin-bottom: 8px; }
        .rel-kicker {
          font-family: var(--font-subhead); font-size: 12px; font-weight: 800;
          letter-spacing: .2em; text-transform: uppercase; color: #490000; margin: 20px 0 0;
        }
        @media (max-width: 760px) { .rel-wrap { padding: 8px 22px 36px; } }
      `}</style>
      <div className="rel-rule" />
      <p className="rel-kicker">Keep Reading</p>
      <StoryRowList posts={picks} />
    </section>
  );
}
