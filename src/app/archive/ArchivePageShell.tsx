import PageVisitTracker from "@/components/PageVisitTracker";
import { getArchivePosts } from "@/lib/content";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import GangreyArchive from "@/components/GangreyArchive";
import ListingHeader from "@/components/ListingHeader";
import { isCurrentVisitorActiveMember } from "@/lib/currentMember";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org";

// Shared body for /archive and /archive/[year]. The year pages exist for
// crawlers as much as readers: the year picker is client state, so without
// them the HTML only ever contained the newest year's story links and the
// other ~2,900 archive pieces received no internal links at all.
export default async function ArchivePageShell({ q = "", year }: { q?: string; year?: string }) {
  let gangrey = [] as Awaited<ReturnType<typeof getArchivePosts>>;
  try { gangrey = await getArchivePosts(); } catch {}
  const isMember = await isCurrentVisitorActiveMember();

  gangrey = gangrey
    .sort((a, b) => {
      const dt = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dt !== 0) return dt;
      return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
    });

  // Ship ONLY the fields the list renders — full post objects put a ~4.7MB
  // payload on this page (see the note in the original page).
  const deduped = gangrey.map(p => ({
    _id: p._id, slug: p.slug, headline: p.headline, date: p.date,
    byline: p.byline || undefined,
    excerpt: (p.body?.[0] as { children?: { text?: string }[] } | undefined)?.children?.[0]?.text || undefined,
    readingTime: p.readingTime,
  }));

  // Breadcrumb trail for search results: Home → Archive (→ year).
  const crumbs = [
    { "@type": "ListItem", position: 1, name: "Gangrey", item: siteUrl },
    { "@type": "ListItem", position: 2, name: "Archive", item: `${siteUrl}/archive` },
    ...(year ? [{ "@type": "ListItem", position: 3, name: year, item: `${siteUrl}/archive/${year}` }] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs,
      }) }} />
      <PageVisitTracker label={year ? `Archive ${year}` : "Archive"} />
      <style>{`
        .gr-wrap { width: 100%; max-width: 1290px; margin: 0 auto; padding: 20px 32px 60px; box-sizing: border-box; flex: 1; }
        @media (max-width: 900px) {
          .gr-wrap { padding: 20px 20px 64px; }
        }
      `}</style>
      <MagHeader />
      <main className="gr-wrap">
        <ListingHeader title="Archive" sub="Writing once featured on the original Gangrey blog." marginBottom={12} />
        {/* Time machine: the full static mirror of the old gangrey.com at
            /delorean — a members-only perk, shown only after sign-in (and the
            route itself checks membership too). */}
        {isMember && (
          <p style={{ margin: "0 0 28px" }}>
            <a href="/delorean/" style={{ display: "inline-block", fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 800, letterSpacing: ".18em", textTransform: "uppercase", color: "#490000", border: "1px solid #490000", padding: "8px 14px", textDecoration: "none" }}>
              Browse the original site (2005–2016) →
            </a>
          </p>
        )}
        {deduped.length === 0
          ? <p style={{ fontFamily: "var(--font-headline)", fontSize: 22, fontStyle: "italic", color: "#000000" }}>No stories yet.</p>
          : <GangreyArchive posts={deduped} initialQuery={q} initialYear={year} />
        }
      </main>
      <MagFooter />
    </div>
  );
}
