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
        /* Styled to match the homepage "Top Stories" cards: dotted vertical
           dividers, kicker label, bold headline, italic byline, small-caps
           read time. Sized to the reading column so it lines up with the body. */
        .rel-wrap { width: 100%; max-width: 680px; margin: 0 auto; padding: 8px 40px 44px; box-sizing: border-box; }
        .rel-rule { border-top: 1px dotted #8a8a8c; margin-bottom: 26px; }
        .rel-head {
          display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 22px;
        }
        .rel-head h2 {
          margin: 0; font-family: var(--font-headline);
          font-size: 22px; font-weight: 800; letter-spacing: -.02em; color: #111111;
        }
        .rel-head a { font-size: 15px; font-style: italic; color: #490000; text-decoration: none; }
        .rel-grid { display: flex; align-items: stretch; }
        .rel-divider { border-left: 1px dotted #8a8a8c; margin: 0 22px; }
        .rel-card { display: block; color: inherit; text-decoration: none; flex: 1; min-width: 0; }
        .rel-thumb { position: relative; display: block; width: 100%; aspect-ratio: 1.35 / 1; background: #b8b8ba; overflow: hidden; margin-bottom: 14px; }
        .rel-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s; }
        .rel-card:hover .rel-thumb img { transform: scale(1.03); }
        .rel-label { font-family: var(--font-subhead); font-size: 10px; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; color: #490000; margin-bottom: 8px; }
        .rel-title { font-family: var(--font-headline); font-size: 20px; line-height: 1.05; letter-spacing: -.02em; font-weight: 800; margin: 0 0 8px; }
        .rel-byline { font-size: 15px; font-style: italic; }
        .rel-time { margin-top: 12px; font-family: var(--font-subhead); font-weight: 700; font-size: 10px; letter-spacing: .16em; text-transform: uppercase; }
        @media (max-width: 760px) {
          .rel-wrap { padding: 8px 22px 36px; }
          .rel-grid { flex-direction: column; }
          .rel-divider { border-left: none; border-top: 1px dotted #8a8a8c; margin: 20px 0; }
        }
      `}</style>
      <div className="rel-rule" />
      <div className="rel-head">
        <h2>Keep Reading</h2>
        <Link href="/latest">View all stories →</Link>
      </div>
      <div className="rel-grid">
        {picks.map((p, i) => {
          const img = postImageUrl(p.image, 600, 444);
          return (
            <div key={p._id} style={{ display: "contents" }}>
              {i > 0 && <div className="rel-divider" />}
              <Link href={`/stories/${p.slug}`} className="rel-card">
                <span className="rel-thumb">
                  {img
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={img} alt={p.image?.alt ?? p.headline} loading="lazy" />
                    : <span style={{ display: "block", width: "100%", height: "100%", background: "#b8b8ba" }} />}
                </span>
                <div className="rel-label">{p.section || "Story"}</div>
                <h3 className="rel-title">{p.headline}</h3>
                <div className="rel-byline">By {p.byline}</div>
                <div className="rel-time">{postReadingTime(p)} Min Read</div>
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
