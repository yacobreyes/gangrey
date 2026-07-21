import Link from "next/link";
import type { Post } from "@/lib/content";
import { postImageUrl } from "@/lib/contentImage";
import { postReadingTime } from "@/lib/readingTime";

// Horizontal story rows (thumbnail / kicker+headline+byline / reading time)
// shared by The Latest and Life, in Brief.
export default function StoryRowList({ posts }: { posts: Post[] }) {
  return (
    <div className="srl">
      <style>{`
        .srl-row {
          display: grid;
          grid-template-columns: 130px 1fr auto;
          gap: 26px;
          padding: 24px 0;
          border-bottom: 1px dotted #8a8a8c;
          align-items: center;
          text-decoration: none;
          color: #000000;
        }
        .srl-row:last-child { border-bottom: none; }
        .srl-thumb {
          position: relative;
          display: block;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #b8b8ba;
          overflow: hidden;
        }
        .srl-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s; }
        .srl-row:hover .srl-thumb img { transform: scale(1.03); }
        .srl-kicker {
          font-family: var(--font-subhead);
          font-weight: 800;
          font-size: 10px;
          letter-spacing: .2em;
          text-transform: uppercase;
          color: #490000;
          margin-bottom: 6px;
        }
        .srl-headline {
          margin: 0 0 5px;
          font-family: var(--font-headline);
          font-size: 26px;
          line-height: 1.05;
          letter-spacing: -.02em;
          font-weight: 800;
          color: #000000;
          transition: color .15s;
        }
        .srl-row:hover .srl-headline { color: #490000; }
        .srl-byline {
          font-family: var(--font-headline);
          font-size: 16px;
          font-style: italic;
          color: #392a22;
        }
        .srl-time {
          font-family: var(--font-subhead);
          font-weight: 700;
          font-size: 10.5px;
          letter-spacing: .14em;
          text-transform: uppercase;
          color: #000000;
          text-align: right;
          white-space: nowrap;
        }
        @media (max-width: 900px) {
          .srl-row { grid-template-columns: 90px 1fr auto; gap: 16px; padding: 20px 0; }
          .srl-headline { font-size: 21px; }
        }
      `}</style>
      {posts.map(post => {
        const imgSrc = postImageUrl(post.image, 520, 293);
        return (
          <Link key={post._id} href={`/stories/${post.slug}`} className="srl-row">
            <span className="srl-thumb">
              {imgSrc
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={imgSrc} alt={post.image?.alt ?? post.headline} />
                : <span style={{ display: "block", width: "100%", height: "100%", background: "#b8b8ba" }} />
              }
            </span>
            <span>
              {post.section && <span className="srl-kicker" style={{ display: "block" }}>{post.section}</span>}
              <h3 className="srl-headline">{post.headline}</h3>
              {post.byline && <span className="srl-byline" style={{ display: "block" }}>{post.byline}</span>}
            </span>
            <span className="srl-time">{postReadingTime(post)} Min</span>
          </Link>
        );
      })}
    </div>
  );
}
