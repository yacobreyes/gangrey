import Link from "next/link";
import type { SanityPost } from "@/lib/sanity";
import { postImageUrl } from "@/lib/sanityImage";
import { plainTextFromBlocks, postReadingTime } from "@/lib/readingTime";

const plainText = plainTextFromBlocks;
function truncate(text: string, max = 150) {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}
function sectionLabel(section: string) {
  return section;
}

export default function StoryCardGrid({ posts, variant = "default" }: { posts: SanityPost[]; variant?: "default" | "archive" }) {
  if (variant === "archive") return <ArchiveCardGrid posts={posts} />;
  return (
    <div className="sg-grid">
      <style>{`
        .sg-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 44px 34px;
        }
        .sg-card { display: flex; flex-direction: column; }
        .sg-thumb {
          aspect-ratio: 1.35 / 1;
          margin-bottom: 20px;
          background: #b8b8ba;
          overflow: hidden;
          display: block;
        }
        .sg-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s; }
        .sg-thumb:hover img { transform: scale(1.03); }
        .sg-label {
          font-family: var(--font-subhead);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .22em;
          color: #490000;
          text-transform: uppercase;
          margin-bottom: 12px;
        }
        .sg-card h3 {
          margin: 0 0 10px;
          font-family: var(--font-headline);
          font-size: 28px;
          line-height: 1.05;
          letter-spacing: -.025em;
          transition: color .15s;
        }
        .sg-card a.sg-headline { text-decoration: none; color: #000000; }
        .sg-card a.sg-headline:hover h3 { color: #490000; }
        .sg-byline {
          font-family: var(--font-headline);
          margin-bottom: 12px;
          font-size: 19px;
          font-style: italic;
          color: #000000;
        }
        .sg-excerpt {
          font-family: var(--font-headline);
          font-size: 18px;
          line-height: 1.45;
          color: #000000;
          margin-bottom: 12px;
        }
        .sg-time {
          font-family: var(--font-subhead);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: #490000;
          margin-top: auto;
        }
        @media (max-width: 900px) {
          .sg-grid { grid-template-columns: 1fr; gap: 0; }
          .sg-card { border-bottom: 1px solid #b8b8ba; padding: 28px 0; }
          .sg-card:first-child { padding-top: 0; }
        }
      `}</style>
      {posts.map(post => {
        const plain = post.searchText ?? plainText(post.body);
        const imgSrc = postImageUrl(post.image, 600, 445);
        return (
          <article key={post._id} className="sg-card">
            <Link href={`/stories/${post.slug}`} className="sg-thumb">
              {imgSrc
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={imgSrc} alt={post.image?.alt ?? post.headline} />
                : <div style={{ width: "100%", height: "100%", background: "#b8b8ba" }} />
              }
            </Link>
            <div className="sg-label">{sectionLabel(post.section)}</div>
            <Link href={`/stories/${post.slug}`} className="sg-headline"><h3>{post.headline}</h3></Link>
            {post.byline && <div className="sg-byline">By {post.byline}</div>}
            {plain && <p className="sg-excerpt">{truncate(plain)}</p>}
            <div className="sg-time">{postReadingTime(post)} Min Read</div>
          </article>
        );
      })}
    </div>
  );
}

// Text-forward "archive clipping" cards for Gangrey Redux, which have no photos.
function ArchiveCardGrid({ posts }: { posts: SanityPost[] }) {
  return (
    <div className="ag-grid">
      <style>{`
        .ag-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0 56px;
        }
        .ag-card {
          display: flex;
          flex-direction: column;
          padding: 30px 0 32px;
          border-top: 2px solid #000000;
        }
        .ag-card + .ag-card { /* keep rules tight across rows handled by grid */ }
        .ag-meta {
          display: flex;
          align-items: baseline;
          gap: 12px;
          font-family: var(--font-subhead);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .2em;
          text-transform: uppercase;
          color: #490000;
          margin-bottom: 16px;
        }
        .ag-meta .ag-dot { color: #b8b8ba; }
        .ag-meta .ag-time { color: #392a22; font-weight: 700; }
        .ag-card h3 {
          margin: 0;
          font-family: var(--font-headline);
          font-size: 34px;
          line-height: 1.02;
          letter-spacing: -.028em;
          transition: color .15s;
        }
        .ag-card a.ag-headline { text-decoration: none; color: #000000; }
        .ag-card a.ag-headline:hover h3 { color: #490000; }
        .ag-byline {
          font-family: var(--font-headline);
          font-size: 19px;
          font-style: italic;
          color: #000000;
          margin: 12px 0 0;
        }
        .ag-excerpt {
          font-family: var(--font-headline);
          font-size: 18.5px;
          line-height: 1.5;
          color: #392a22;
          margin: 14px 0 0;
        }
        .ag-excerpt::first-letter {
          initial-letter: 2;
          -webkit-initial-letter: 2;
          font-weight: 600;
          margin-right: 8px;
          color: #490000;
        }
        @media (max-width: 760px) {
          .ag-grid { grid-template-columns: 1fr; gap: 0; }
        }
      `}</style>
      {posts.map(post => {
        const plain = post.searchText ?? plainText(post.body);
        return (
          <article key={post._id} className="ag-card">
            <div className="ag-meta">
              <span>Gangrey&nbsp;Redux</span>
              <span className="ag-dot">/</span>
              <span className="ag-time">{postReadingTime(post)} Min Read</span>
            </div>
            <Link href={`/stories/${post.slug}`} className="ag-headline"><h3>{post.headline}</h3></Link>
            {post.byline && <div className="ag-byline">By {post.byline}</div>}
            {plain && <p className="ag-excerpt">{truncate(plain, 240)}</p>}
          </article>
        );
      })}
    </div>
  );
}
