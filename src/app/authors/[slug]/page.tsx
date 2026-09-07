import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import PageVisitTracker from "@/components/PageVisitTracker";
import { getAuthorBySlug } from "@/lib/authors";
import { postReadingTime } from "@/lib/readingTime";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org";

// One page per Imago writer, built from their user profile (photo, job title,
// bio) and their published stories. The page only exists once a story is
// published under their byline; getAuthorBySlug returns null otherwise.
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const author = getAuthorBySlug(slug);
  if (!author) return {};
  return {
    title: `The Sunland Tribune | ${author.name}`,
    description: author.bio || `Stories by ${author.name} in The Sunland Tribune, a literary magazine.`,
    alternates: { canonical: `/authors/${slug}` },
  };
}

export default async function AuthorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const author = getAuthorBySlug(slug);
  if (!author) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: author.name,
    url: `${siteUrl}/authors/${slug}`,
    ...(author.jobTitle ? { jobTitle: author.jobTitle } : {}),
    ...(author.bio ? { description: author.bio } : {}),
    ...(author.photoUrl ? { image: `${siteUrl}${author.photoUrl}` } : {}),
    worksFor: { "@id": `${siteUrl}/#organization` },
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "The Sunland Tribune", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "Authors", item: `${siteUrl}/authors` },
      { "@type": "ListItem", position: 3, name: author.name, item: `${siteUrl}/authors/${slug}` },
    ],
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <PageVisitTracker label={`Author ${author.name}`} />
      <style>{`
        .au-wrap { width: 100%; max-width: 880px; margin: 0 auto; padding: 32px 32px 72px; box-sizing: border-box; flex: 1; }
        .au-head { display: flex; gap: 28px; align-items: flex-start; border-bottom: 1px solid #000000; padding-bottom: 28px; margin-bottom: 8px; }
        .au-photo { width: 108px; height: 108px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: #f4f4f5; }
        .au-name { font-family: var(--font-headline); font-size: clamp(24px, 3.4vw, 31px); font-weight: 800; letter-spacing: -.02em; line-height: 1.1; margin: 0 0 4px; }
        .au-title { font-family: var(--font-subhead); font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #490000; margin: 0 0 10px; }
        .au-bio { font-family: var(--font-body); font-size: 16.5px; line-height: 1.6; color: #392a22; margin: 0; max-width: 560px; }
        .au-row { display: grid; grid-template-columns: 1fr auto; gap: 0 32px; padding: 24px 0; border-bottom: 1px solid #b8b8ba; align-items: start; }
        .au-row:last-child { border-bottom: none; }
        .au-kicker { font-family: var(--font-subhead); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #392a22; margin-bottom: 8px; }
        .au-kicker .sec { color: #490000; }
        .au-h { font-family: var(--font-headline); font-size: clamp(22px, 3vw, 28px); font-weight: 800; line-height: 1.08; letter-spacing: -.02em; color: #000000; text-decoration: none; display: block; }
        .au-h:hover { color: #490000; }
        .au-dek { font-family: var(--font-headline); font-size: 16px; line-height: 1.5; color: #392a22; margin: 8px 0 0; }
        .au-time { font-family: var(--font-subhead); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #490000; padding-top: 26px; white-space: nowrap; }
        @media (max-width: 700px) {
          .au-wrap { padding: 24px 20px 56px; }
          .au-head { gap: 18px; }
          .au-photo { width: 76px; height: 76px; }
          .au-row { grid-template-columns: 1fr; gap: 6px; }
          .au-time { padding-top: 0; }
        }
      `}</style>
      <MagHeader />
      <main className="au-wrap">
        <div className="au-head">
          {author.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="au-photo" src={`${author.photoUrl}?w=216&h=216`} alt={author.name} />
          )}
          <div>
            <h1 className="au-name">{author.name}</h1>
            {author.jobTitle && <p className="au-title">{author.jobTitle}</p>}
            {author.bio && <p className="au-bio">{author.bio}</p>}
          </div>
        </div>
        {author.stories.map(p => (
          <article className="au-row" key={p._id}>
            <div>
              <div className="au-kicker"><span className="sec">{p.section || "Story"}</span> · {fmtDate(p.date)}</div>
              <Link href={`/stories/${p.slug}`} className="au-h">{p.headline}</Link>
              {p.subheadline && <p className="au-dek">{p.subheadline}</p>}
            </div>
            <div className="au-time">{postReadingTime(p)} min</div>
          </article>
        ))}
      </main>
      <MagFooter />
    </div>
  );
}
