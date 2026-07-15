import { notFound, redirect } from "next/navigation";
import { isAuthed } from "@/lib/adminAuth";
import { client } from "@/lib/sanity";
import type { SanityPost } from "@/lib/sanity";
import { postImageUrl } from "@/lib/sanityImage";
import { isSqliteBackend, sqliteGetPost } from "@/lib/storage/sqlite";
import { PortableText } from "@portabletext/react";
import Link from "next/link";
import CommentSection from "@/components/CommentSection";
import LikeButton from "@/components/LikeButton";
import ShareButton from "@/components/ShareButton";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import { postReadingTime } from "@/lib/readingTime";
import { storyStyles, storyPtComponents, splitCaption } from "@/components/storyTheme";
import { stripEmptyBlocks } from "@/lib/tiptapConvert";

export const dynamic = "force-dynamic";

function sectionLabel(section: string) {
  if (section === "Micro-Memoir") return "Micro-Memoir";
  if (section === "Archive") return "Archive";
  return section;
}

const QUERY = `*[_type == "post" && slug.current == $slug][0]{
  _id, "slug": slug.current, section, headline, subheadline, byline,
  date, body, image { asset, caption, alt }, status, readingTime
}`;

export default async function PreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const authed = await isAuthed();
  if (!authed) redirect("/admin/imago");

  const { slug } = await params;
  const post = isSqliteBackend()
    ? sqliteGetPost(slug)
    : await client.fetch<SanityPost | null>(QUERY, { slug }, { cache: "no-store" });
  if (!post) notFound();

  const caption = post.image?.caption ? splitCaption(post.image.caption) : null;
  const heroImg = postImageUrl(post.image, 1600, 900);

  return (
    <div className="story-page">
      <style>{`
        ${storyStyles}
        .preview-banner {
          background: #490000;
          color: #fff;
          font-family: var(--font-subhead);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: .12em;
          text-transform: uppercase;
          text-align: center;
          padding: 8px 16px;
        }
      `}</style>

      <div className="preview-banner">Preview — {post.status ?? "draft"} (not public)</div>

      <MagHeader />

      <header className="story-head">
        <Link href="/" className="story-label">← {sectionLabel(post.section)}</Link>
        <h1 className="story-h1">{post.headline}</h1>
        {post.subheadline && <p className="story-dek">{post.subheadline}</p>}
        <div className="story-meta">
          <span>By {post.byline}</span>
          <span className="dot">·</span>
          <span>{new Date(post.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
          <span className="dot">·</span>
          <span className="rt">{postReadingTime(post)} Min Read</span>
        </div>
      </header>

      {heroImg && (
        <>
          <div className="story-hero-wrap">
            <div className="story-hero">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroImg}
                alt={post.image?.alt ?? post.image?.caption ?? ""}
              />
            </div>
          </div>
          {caption && (
            <div className="story-cutline-wrap">
              <div className="story-cutline">
                <strong>{caption.lead}</strong>
                {caption.credit && <> — {caption.credit}</>}
              </div>
            </div>
          )}
        </>
      )}

      <article className="story-article">
        <div className="story-body">
          <PortableText value={post.section === "Archive" ? stripEmptyBlocks(post.body) : post.body} components={storyPtComponents} />
        </div>
      </article>

      <div className="story-foot">
        <div className="story-foot-rule" />
        <div className="story-actions">
          <span className="story-like"><LikeButton slug={slug} /></span>
          <ShareButton slug={slug} headline={post.headline} />
        </div>
      </div>

      <div className="story-comments">
        <CommentSection slug={slug} />
      </div>

      <MagFooter />
    </div>
  );
}
