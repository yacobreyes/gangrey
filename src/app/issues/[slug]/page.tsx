import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { client } from "@/lib/sanity";
import { isSqliteBackend, sqliteGetDoc, sqliteDocsByType } from "@/lib/storage/sqlite";
import { renderNewsletterPageHtml, type NlCard } from "@/lib/newsletterEmail";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";

export const revalidate = 60;

type IssueDoc = { newsletterId?: string; title?: string; description?: string };
type NewsletterDoc = {
  subject?: string; preview?: string; intro?: string;
  author?: string; volume?: string; issue?: string; classics?: boolean; cards?: NlCard[];
};

async function getIssue(slug: string): Promise<IssueDoc | null> {
  if (isSqliteBackend()) {
    return sqliteDocsByType<IssueDoc & { slug?: { current?: string } }>("issue")
      .find(i => i.slug?.current === slug) ?? null;
  }
  return client.fetch(
    `*[_type == "issue" && slug.current == $slug][0]{ newsletterId, title, description }`,
    { slug },
    { next: { revalidate: 60 } }
  );
}

async function getNewsletter(id: string): Promise<NewsletterDoc | null> {
  if (isSqliteBackend()) return sqliteGetDoc<NewsletterDoc>(id);
  return client.fetch(
    `*[_id == $id][0]{ subject, preview, intro, author, volume, issue, classics, cards }`,
    { id },
    { next: { revalidate: 60 } }
  );
}


export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const issue = await getIssue(slug);
  if (!issue) return { title: "Gangrey | Issue" };
  return {
    title: `Gangrey | ${issue.title ?? "Issue"}`,
    description: issue.description ?? undefined,
    alternates: { canonical: `/issues/${slug}` },
  };
}

export default async function IssuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const issue = await getIssue(slug);
  if (!issue?.newsletterId) notFound();
  const nl = await getNewsletter(issue.newsletterId);
  if (!nl) notFound();

  const html = renderNewsletterPageHtml({
    subject: nl.subject ?? "",
    preview: nl.preview ?? "",
    intro: nl.intro ?? "",
    author: nl.author ?? "",
    volume: nl.volume ?? "",
    issue: nl.issue ?? "",
    classics: nl.classics,
    cards: (nl.cards ?? []) as NlCard[],
  });

  return (
    <div className="issue-read-page">
      <style>{`
        .issue-read-page { min-height: 100vh; display: flex; flex-direction: column; background: #ffffff; }
        .issue-read-main { flex: 1; width: 100%; padding: 20px 0 48px; background: #ffffff; }
        /* 600px sheet centered on white, edge defined by a hairline ring + a
           SMALL shadow. Keep the blur radius modest: this element can be
           10,000+ px tall on a long issue, and a large blurred shadow on a
           layer that big is expensive to rasterize — it contributed to the
           blank-stripe repaint glitch while scrolling. */
        .issue-read-main > div { max-width: 600px; margin: 0 auto; box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 2px 10px rgba(0,0,0,0.14); }
      `}</style>
      <MagHeader />
      <main className="issue-read-main">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </main>
      <MagFooter />
    </div>
  );
}
