import Link from "next/link";
import { getPostsLight } from "@/lib/sanity";
import { postImageUrl } from "@/lib/sanityImage";
import { postReadingTime } from "@/lib/readingTime";

// "Keep reading" row at the foot of a story: up to three more pieces, preferring
// the same section, backfilled with the most recent others. Server component;
// uses the lightweight post list (no portable-text bodies) so it's cheap.
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
        /* Match the story reading column (680px) so it lines up with the body,
           actions and comments — not a wider band that sticks out. */
        .rel-wrap { width: 100%; max-width: 680px; margin: 0 auto; padding: 8px 40px 40px; box-sizing: border-box; }
        .rel-rule { border-top: 1px dotted #8a8a8c; margin-bottom: 24px; }
        .rel-kicker {
          font-family: var(--font-subhead); font-size: 12px; font-weight: 800;
          letter-spacing: .2em; text-transform: uppercase; color: #490000; margin: 0 0 20px;
        }
        /* auto-fit so 1, 2, or 3 cards always fill the row evenly — no dead
           empty column when there are only two related stories. */
        .rel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 26px; }
        .rel-card { display: block; color: inherit; text-decoration: none; }
        .rel-thumb { position: relative; width: 100%; aspect-ratio: 3 / 2; background: #b8b8ba; overflow: hidden; margin-bottom: 12px; }
        .rel-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s; }
        .rel-card:hover .rel-thumb img { transform: scale(1.03); }
        .rel-label { font-family: var(--font-subhead); font-size: 10px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; color: #490000; margin-bottom: 6px; }
        .rel-title { font-family: var(--font-headline); font-size: 18px; line-height: 1.12; letter-spacing: -.01em; font-weight: 800; margin: 0 0 6px; }
        .rel-meta { font-family: var(--font-subhead); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #6b6b6b; }
        @media (max-width: 760px) {
          .rel-wrap { padding: 8px 22px 32px; }
          .rel-grid { grid-template-columns: 1fr; gap: 22px; }
        }
      `}</style>
      <div className="rel-rule" />
      <p className="rel-kicker">Keep Reading</p>
      <div className="rel-grid">
        {picks.map(p => {
          const img = postImageUrl(p.image, 600, 400);
          return (
            <Link key={p._id} href={`/stories/${p.slug}`} className="rel-card">
              <span className="rel-thumb">
                {img
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={img} alt={p.image?.alt ?? p.headline} loading="lazy" />
                  : <span style={{ display: "block", width: "100%", height: "100%", background: "#b8b8ba" }} />}
              </span>
              <div className="rel-label">{p.section || "Story"}</div>
              <h3 className="rel-title">{p.headline}</h3>
              <div className="rel-meta">By {p.byline} · {postReadingTime(p)} Min</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
