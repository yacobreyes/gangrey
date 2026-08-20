import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import ListingHeader from "@/components/ListingHeader";
import StoryRowList from "@/components/StoryRowList";
import PageVisitTracker from "@/components/PageVisitTracker";
import { getPostsLight } from "@/lib/content";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org";

// Real section index pages. /narratives, /essays and /micro-memoirs used to be
// rewrites to the homepage, so all three URLs served the homepage's title and
// a canonical pointing at "/": they told Google to ignore them. Each is now a
// server-rendered listing with its own metadata, linked from every story's
// section label so they are not orphans, and "micro-memoirs" can rank as the searchable term
// it actually is.
export type SectionDef = { path: string; section: string; title: string; description: string };

export const SECTIONS: SectionDef[] = [
  { path: "narratives", section: "Narratives", title: "Narratives", description: "Short reported narratives published in Gangrey, a literary magazine of true stories." },
  { path: "essays", section: "Essays", title: "Essays", description: "Essays published in Gangrey, a literary magazine of true stories." },
  { path: "micro-memoirs", section: "Micro-Memoir", title: "Micro-Memoirs", description: "Micro-memoirs published in Gangrey, a literary magazine of true stories." },
];

export default async function SectionListing({ def }: { def: SectionDef }) {
  let posts: Awaited<ReturnType<typeof getPostsLight>> = [];
  try { posts = await getPostsLight(); } catch {}
  const stories = posts
    .filter(p => p.section === def.section)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Gangrey", item: siteUrl },
      { "@type": "ListItem", position: 2, name: def.title, item: `${siteUrl}/${def.path}` },
    ],
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <PageVisitTracker label={def.title} />
      <MagHeader />
      <main style={{ width: "100%", maxWidth: 880, margin: "0 auto", padding: "20px 32px 72px", boxSizing: "border-box", flex: 1 }}>
        <ListingHeader title={def.title} marginBottom={8} />
        {stories.length === 0
          ? <p style={{ fontFamily: "var(--font-headline)", fontSize: 22, fontStyle: "italic" }}>No stories yet.</p>
          : <StoryRowList posts={stories} />}
      </main>
      <MagFooter />
    </div>
  );
}
