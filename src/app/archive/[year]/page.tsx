import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ArchivePageShell from "../ArchivePageShell";

// Crawlable per-year archive pages. The year picker on /archive is client
// state, so without these URLs the rendered HTML only ever linked the newest
// year's stories — ~2,900 archive pieces had no internal links at all. Each
// year page server-renders that year's full story list.
export const dynamic = "force-dynamic";

function validYear(y: string): boolean {
  return /^(19|20)\d\d$/.test(y);
}

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  if (!validYear(year)) return {};
  // /archive itself renders the newest year, so the newest year's own URL is
  // a duplicate of it. Point its canonical at /archive (and the year nav
  // links the newest year as /archive) so we choose the canonical instead of
  // making Google choose one for us.
  const { getArchivePosts } = await import("@/lib/content");
  let newest = "";
  try {
    const posts = await getArchivePosts();
    newest = String(Math.max(...posts.map(p => new Date(p.date).getUTCFullYear()).filter(Number.isFinite)));
  } catch { /* fall through to self-canonical */ }
  return {
    title: `The Sunland Tribune | Archive: ${year}`,
    description: `Stories from ${year} once featured on the original Gangrey blog.`,
    alternates: { canonical: year === newest ? "/archive" : `/archive/${year}` },
  };
}

export default async function ArchiveYearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  if (!validYear(year)) notFound();
  return <ArchivePageShell year={year} />;
}
