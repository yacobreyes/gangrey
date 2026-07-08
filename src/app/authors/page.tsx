import type { Metadata } from "next";
import { client } from "@/lib/sanity";
import { isSqliteBackend, sqliteAllPublishedPosts } from "@/lib/storage/sqlite";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import AuthorsClient from "./AuthorsClient";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Gangrey | Authors",
  alternates: { canonical: "/authors" },
  description: "Every writer published in Gangrey.",
};

// Exclude archive (Archive) pieces — the author board only lists
// writers featured in Gangrey proper, not the imported archive.
const QUERY = `*[_type == "post" && (status == "published" || !defined(status)) && defined(byline) && byline != "" && section != "Archive"] {
  "byline": byline
}`;

export default async function AuthorsPage() {
  let bylines: { byline: string }[] = [];
  if (isSqliteBackend()) {
    bylines = sqliteAllPublishedPosts()
      .filter(p => p.section !== "Archive" && p.byline?.trim())
      .map(p => ({ byline: p.byline }));
  } else {
    try { bylines = await client.fetch(QUERY, {}, { next: { revalidate: 60 } }); } catch {}
  }

  // Count posts per author and sort alphabetically by last name
  const counts = new Map<string, number>();
  for (const { byline } of bylines) {
    const name = byline.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const authors = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      const lastA = a.name.split(/\s+/).at(-1)!.toLowerCase();
      const lastB = b.name.split(/\s+/).at(-1)!.toLowerCase();
      return lastA.localeCompare(lastB);
    });

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff" }}>
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
