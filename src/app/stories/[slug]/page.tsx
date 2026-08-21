import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { PortableText } from "@portabletext/react";
import { getPost } from "@/lib/content";
import { postImageUrl } from "@/lib/contentImage";
import CommentSection from "@/components/CommentSection";
import RelatedStories from "@/components/RelatedStories";
import LikeButton from "@/components/LikeButton";
import ShareButton from "@/components/ShareButton";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import StoryVisitTracker from "@/components/StoryVisitTracker";
import MeterPing from "@/components/MeterPing";
import StoryPaywall from "@/components/StoryPaywall";
import { postReadingTime } from "@/lib/readingTime";
import { storyStyles, storyPtComponents, splitCaption } from "@/components/storyTheme";
import { storyRequiresMembership, previewBody } from "@/lib/storyAccess";
import { stripEmptyBlocks } from "@/lib/tiptapConvert";
import { isCurrentVisitorActiveMember } from "@/lib/currentMember";

function sectionLabel(section: string) {
  if (section === "Micro-Memoir") return "Micro-Memoir";
  if (section === "Archive") return "Archive";
  return section;
}

// Story pages render per-request. They can't be static/ISR: gated stories
// (Archive, access:"paid") read the session cookie for the membership check,
// and any static-generation attempt of such a path (build-time via
// generateStaticParams, or on-demand ISR fill-in) throws DYNAMIC_SERVER_USAGE
// and 500s. A per-request render on local SQLite is milliseconds — correctness
// over a cache we don't need at this scale.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};

  const bodyText = post.body.filter(b => b._type === "block")
    .map(b => (b.children as { text: string }[]).map(c => c.text).join(""))
    .join(" ").slice(0, 160).trim();

  const seoTitle = post.seoHeadline || post.headline;
  const socialTitle = post.socialHeadline || post.headline;
  const description = post.socialDescription || post.subheadline || bodyText;
  const seoDescription = post.socialDescription || post.subheadline || bodyText;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org";
  const postUrl = `${siteUrl}/stories/${slug}`;
  // Shared links use the story's own featured image (falls back to the default
  // OG card if the post has no photo).
  const photo = postImageUrl(post.image, 1200, 630);
  const ogImage = photo
    ? { url: photo.startsWith("http") ? photo : siteUrl + photo, width: 1200, height: 630, alt: post.headline }
    : { url: "/open-graph.png", width: 1200, height: 630, alt: "Gangrey" };

  return {
    title: `Gangrey | ${seoTitle}`,
    description: seoDescription,
    alternates: { canonical: `/stories/${slug}` },
    openGraph: {
      type: "article",
      url: postUrl,
      title: socialTitle,
      description,
      siteName: "Gangrey",
      publishedTime: post.date,
      authors: [post.byline],
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [ogImage.url],
    },
  };
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) {
    // A renamed story leaves a 301 behind so old links/rankings survive.
    const { sqliteRedirectTarget } = await import("@/lib/storage/sqlite");
    const target = sqliteRedirectTarget(slug);
    if (target && target !== slug) permanentRedirect(`/stories/${target}`);
    // Import-era archive slugs that no longer resolve: gangrey-p<id> from the
    // first import, and gangrey-<n> ordinals that existed in an earlier
    // import but were dropped by the rebuild (a live ordinal was renamed by
    // the headline re-slug and is caught by the redirect lookup above, so
    // only dead ones reach this line). Google still remembers both kinds;
    // send them to the archive permanently instead of dead-ending.
    // Two shapes: gangrey-p<anything> (first import appended either a numeric
    // id OR a slugified headline after the p) and bare gangrey-<digits>
    // ordinals from the rebuild-era numbering. Anchored so a renamed headline
    // slug that merely starts with "gangrey-" is never swallowed.
    if (/^gangrey-p/.test(slug) || /^gangrey-\d+$/.test(slug)) permanentRedirect("/archive");
    notFound();
  }
  // A scheduled story is hidden from listings until its time — but getPost
  // returns it regardless, so guard the direct URL too. Not-yet-due scheduled
  // (and trashed) posts 404 for the public; admins preview via /preview.
  const notYetDue = post.status === "scheduled" && post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now();
  if (notYetDue || post.status === "trashed") notFound();

  // Members-only stories show a preview + paywall to non-members. Reading the
  // session cookie makes this route render per-request (opts out of caching)
  // for gated stories, which is correct — a paywall can't be statically cached.
  const gated = storyRequiresMembership(post);
  const isMember = gated ? await isCurrentVisitorActiveMember() : false;
  // Metered paywall: a non-member gets METER_LIMIT free members-only reads per
  // month before the wall. Already-read-this-month stories always open (no
  // re-wall). This view is recorded client-side (see MeterPing) so the count
  // reflects real reads.
  let metered = false; // true when this non-member view counts against the meter
  let unlocked = !gated || isMember;
  if (gated && !isMember) {
    const { sqliteMeterCount, sqliteMeterHasRead } = await import("@/lib/storage/sqlite");
    const { METER_COOKIE, METER_LIMIT, meterMonth } = await import("@/lib/meter");
    const { cookies } = await import("next/headers");
    const meterId = (await cookies()).get(METER_COOKIE)?.value ?? "";
    const month = meterMonth();
    const already = sqliteMeterHasRead(meterId, slug, month);
    if (already || sqliteMeterCount(meterId, month) < METER_LIMIT) { unlocked = true; metered = !already; }
  }
  // Drop blank paragraph blocks (an Archive-import relic) so posts read with
  // normal spacing instead of huge empty gaps between paragraphs.
  const cleanBody = stripEmptyBlocks(post.body);
  const bodyToRender = unlocked ? cleanBody : previewBody(cleanBody);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.headline,
    description: post.subheadline ?? "",
    author: { "@type": "Person", name: post.byline },
    datePublished: post.date,
    dateModified: post._updatedAt ?? post.date,
    // Reference the site-level Organization by id (defined in the root layout)
    // rather than restating an anonymous copy, so every article resolves to
    // the one brand entity.
    publisher: { "@id": `${siteUrl}/#organization` },
    isPartOf: { "@id": `${siteUrl}/#website` },
    url: `${siteUrl}/stories/${slug}`,
    ...(postImageUrl(post.image, 1200, 630) ? { image: postImageUrl(post.image, 1200, 630) } : {}),
    // Google's paywalled-content signal — declares the gated body so serving a
    // preview to crawlers isn't treated as cloaking.
    ...(gated ? {
      isAccessibleForFree: false,
      hasPart: {
        "@type": "WebPageElement",
        isAccessibleForFree: false,
        cssSelector: ".story-body",
      },
    } : {}),
  };

  const caption = post.image?.caption ? splitCaption(post.image.caption) : null;

  // Bylines link to the writer's author page when one exists (an Imago user
  // with a published story); archive bylines without a profile stay text.
  const { authorHrefForByline } = await import("@/lib/authors");
  const authorHref = authorHrefForByline(post.byline);

  return (
    <div className="story-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {/* Breadcrumb trail: Home → section listing → this story. Replaces the
          raw URL under results with a readable path. Archive stories point at
          /archive; current sections at their listing rewrite. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Gangrey", item: siteUrl },
          {
            "@type": "ListItem", position: 2,
            name: post.section === "Archive" ? "Archive" : (post.section || "Latest"),
            item: post.section === "Archive" ? `${siteUrl}/archive`
              : post.section === "Micro-Memoir" ? `${siteUrl}/micro-memoirs`
              : post.section === "Narratives" ? `${siteUrl}/narratives`
              : post.section === "Essays" ? `${siteUrl}/essays`
              : `${siteUrl}/latest`,
          },
          { "@type": "ListItem", position: 3, name: post.headline, item: `${siteUrl}/stories/${slug}` },
        ],
      }) }} />
      <style>{storyStyles}</style>

      <MagHeader />

      <header className="story-head">
        {/* The section label is a plain link to the section page (no arrow, no
            back-button behavior; the masthead covers "home"). These are the
            internal links that keep /narratives, /essays and /micro-memoirs
            from being orphans now that they left the footer. */}
        <a className="story-label" href={
          post.section === "Archive" ? "/archive"
          : post.section === "Narratives" ? "/narratives"
          : post.section === "Essays" ? "/essays"
          : post.section === "Micro-Memoir" ? "/micro-memoirs"
          : "/latest"}>{sectionLabel(post.section)}</a>
        <h1 className="story-h1">{post.headline}</h1>
        {post.subheadline && <p className="story-dek">{post.subheadline}</p>}
        <div className="story-meta">
          <span>By {authorHref
            ? <a href={authorHref} style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 3 }}>{post.byline}</a>
            : post.byline}</span>
          <span className="dot">·</span>
          <span>{new Date(post.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
          <span className="dot">·</span>
          <span className="rt">{postReadingTime(post)} Min Read</span>
        </div>
      </header>

      {postImageUrl(post.image) && (
        <>
          <div className="story-hero-wrap">
            <div className="story-hero">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={postImageUrl(post.image, 1200, 675)!}
                srcSet={[
                  `${postImageUrl(post.image, 800, 450)} 800w`,
                  `${postImageUrl(post.image, 1200, 675)} 1200w`,
                  `${postImageUrl(post.image, 1600, 900)} 1600w`,
                ].join(", ")}
                // Hero is full-width on phones, capped at the 600px reading
                // column on desktop — so a phone downloads the 800/1200 crop
                // instead of the full 1600, cutting the load lapse over cellular.
                sizes="(max-width: 720px) 100vw, 600px"
                alt={post.image?.alt ?? post.image?.caption ?? ""}
                // Above-the-fold hero: fetch it immediately with priority
                // rather than letting the browser lazy-queue it.
                fetchPriority="high"
                decoding="async"
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
          <PortableText value={bodyToRender} components={storyPtComponents} />
        </div>
        {!unlocked && <StoryPaywall />}
      </article>

      <div className="story-foot">
        <div className="story-actions">
          <span className="story-like"><LikeButton slug={slug} /></span>
          <ShareButton slug={slug} headline={post.headline} />
        </div>
      </div>

      <RelatedStories slug={slug} section={post.section} />

      <div className="story-comments">
        <CommentSection slug={slug} />
      </div>

      <StoryVisitTracker slug={slug} />
      {metered && <MeterPing slug={slug} />}
      <MagFooter />
    </div>
  );
}
