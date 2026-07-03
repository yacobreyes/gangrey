import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PortableText } from "@portabletext/react";
import { getAllSlugs, getPost, urlFor } from "@/lib/sanity";
import CommentSection from "@/components/CommentSection";
import LikeButton from "@/components/LikeButton";
import ShareButton from "@/components/ShareButton";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import StoryBackLink from "@/components/StoryBackLink";
import StoryVisitTracker from "@/components/StoryVisitTracker";
import StoryPaywall from "@/components/StoryPaywall";
import { postReadingTime } from "@/lib/readingTime";
import { storyStyles, storyPtComponents, splitCaption } from "@/components/storyTheme";
import { storyRequiresMembership, previewBody } from "@/lib/storyAccess";
import { isCurrentVisitorActiveMember } from "@/lib/currentMember";

function sectionLabel(section: string) {
  if (section === "Micro-Memoir") return "Micro-Memoir";
  if (section === "Archive") return "Archive";
  return section;
}

export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    const slugs = await getAllSlugs();
    return slugs.map(slug => ({ slug }));
  } catch {
    return [];
  }
}

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

  const imageUrl = post.image?.asset
    ? urlFor(post.image.asset).width(1200).height(630).fit("crop").auto("format").url()
    : null;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org";
  const postUrl = `${siteUrl}/stories/${slug}`;
  const ogImage = imageUrl
    ? { url: imageUrl, width: 1200, height: 630, alt: post.headline }
    : { url: "/open-graph.png", width: 1200, height: 630, alt: "Gangrey" };

  return {
    title: `Gangrey | ${seoTitle}`,
    description: seoDescription,
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
  if (!post) notFound();

  // Members-only stories show a preview + paywall to non-members. Reading the
  // session cookie makes this route render per-request (opts out of caching)
  // for gated stories, which is correct — a paywall can't be statically cached.
  const gated = storyRequiresMembership(post);
  const unlocked = gated ? await isCurrentVisitorActiveMember() : true;
  const bodyToRender = unlocked ? post.body : previewBody(post.body);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.headline,
    description: post.subheadline ?? "",
    author: { "@type": "Person", name: post.byline },
    datePublished: post.date,
    dateModified: post._updatedAt ?? post.date,
    publisher: { "@type": "Organization", name: "Gangrey", url: siteUrl },
    url: `${siteUrl}/stories/${slug}`,
    ...(post.image?.asset ? { image: urlFor(post.image.asset).width(1200).height(630).url() } : {}),
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

  return (
    <div className="story-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <style>{storyStyles}</style>

      <MagHeader />

      <header className="story-head">
        <StoryBackLink label={sectionLabel(post.section)} fallbackHref={post.section === "Archive" ? "/archive" : "/latest"} />
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

      {post.image?.asset && (
        <>
          <div className="story-hero-wrap">
            <div className="story-hero">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={urlFor(post.image.asset).width(1600).height(900).fit("crop").auto("format").url()}
                alt={post.image.alt ?? post.image.caption ?? ""}
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
        <div className="story-foot-rule" />
        <div className="story-actions">
          <span className="story-like"><LikeButton slug={slug} /></span>
          <ShareButton slug={slug} headline={post.headline} />
        </div>
      </div>

      <div className="story-comments">
        <CommentSection slug={slug} />
      </div>

      <StoryVisitTracker />
      <MagFooter />
    </div>
  );
}
