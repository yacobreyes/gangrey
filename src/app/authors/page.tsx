import type { Metadata } from "next";
import PageVisitTracker from "@/components/PageVisitTracker";
import { sqliteAllPublishedPosts } from "@/lib/storage/sqlite";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import AuthorsClient from "./AuthorsClient";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Gangrey | Authors",
  alternates: { canonical: "/authors" },
  description: "Every writer published in Gangrey.",
};

export default async function AuthorsPage() {
  // Exclude archive (Archive) pieces — the author board only lists
  // writers featured in Gangrey proper, not the imported archive.
  const bylines: { byline: string }[] = sqliteAllPublishedPosts()
    .filter(p => p.section !== "Archive" && p.byline?.trim())
    .map(p => ({ byline: p.byline }));

  // Count posts per author and sort alphabetically by last name
  const counts = new Map<string, number>();
  for (const { byline } of bylines) {
    const name = byline.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  // Names that belong to an Imago user with a published story link to their
  // author page; the rest render as plain text.
  const { listPublishedAuthors } = await import("@/lib/authors");
  const hrefByName = new Map(listPublishedAuthors().map(a => [a.name, `/authors/${a.slug}`]));
  const authors = [...counts.entries()]
    .map(([name, count]) => ({ name, count, href: hrefByName.get(name) }))
    .sort((a, b) => {
      const lastA = a.name.split(/\s+/).at(-1)!.toLowerCase();
      const lastB = b.name.split(/\s+/).at(-1)!.toLowerCase();
      return lastA.localeCompare(lastB);
    });

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff" }}>
      <PageVisitTracker label="Authors" />
      <style>{`
        .authors-main { width: 100%; max-width: 1290px; margin: 0 auto; padding: 20px 32px 60px; box-sizing: border-box; flex: 1; }
        @media (max-width: 900px) { .authors-main { padding: 20px 20px 64px; } }
      `}</style>
      <MagHeader />
      <main className="authors-main">
        <AuthorsClient authors={authors} />
      </main>
      <MagFooter />
    </div>
  );
}
