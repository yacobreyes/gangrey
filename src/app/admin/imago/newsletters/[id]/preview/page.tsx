import { isAuthed } from "@/lib/adminAuth";
import { redirect, notFound } from "next/navigation";
import { client } from "@/lib/sanity";
import { isSqliteBackend, sqliteGetDoc } from "@/lib/storage/sqlite";
import { renderNewsletterHtml, type NlCard } from "@/lib/newsletterEmail";

export const dynamic = "force-dynamic";

// Email preview for a newsletter, mirroring /stories/[slug]/preview for posts.
// Renders the exact HTML subscribers receive, inside a full-screen iframe.
export default async function NewsletterPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const authed = await isAuthed();
  if (!authed) redirect("/admin/imago");

  const { id } = await params;
  const nl = isSqliteBackend()
    ? sqliteGetDoc<{ subject?: string; preview?: string; intro?: string; author?: string; volume?: string; issue?: string; cards?: NlCard[] }>(id)
    : await client.fetch(`*[_id == $id][0]{ subject, preview, intro, author, volume, issue, cards }`, { id }, { cache: "no-store" });
  if (!nl) notFound();

  const html = renderNewsletterHtml({
    subject: nl.subject ?? "",
    preview: nl.preview ?? "",
    intro: nl.intro ?? "",
    author: nl.author ?? "",
    volume: nl.volume ?? "",
    issue: nl.issue ?? "",
    cards: (nl.cards ?? []) as NlCard[],
  });

  return (
    <iframe
      title="Newsletter preview"
      srcDoc={html}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: "none" }}
    />
  );
}
