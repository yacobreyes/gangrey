import type { Metadata } from "next";
import PageVisitTracker from "@/components/PageVisitTracker";
import HomeClient from "@/components/HomeClient";
import { getPostsLight, getAboutPage, getLately, getWelcome } from "@/lib/content";
import { ptToParagraphs } from "@/lib/parseBody";

export const revalidate = 60;

// Self-referencing canonical so Google indexes the clean homepage URL and
// ignores query-string variants (?q=, ?tab=) as duplicates.
export const metadata: Metadata = { alternates: { canonical: "/" } };

type Tab = "Home" | "About" | "Micro-Memoirs" | "Narratives" | "Essays" | "Archive";

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const { tab, q } = await searchParams;
  const initialTab: Tab = (["Home", "About", "Micro-Memoirs", "Narratives", "Essays", "Archive"].includes(tab ?? "") ? tab : "Home") as Tab;

  const [postsResult, aboutResult, latelyResult, welcomeResult] = await Promise.allSettled([
    // Only pull the heavy full-text search field when the user is actually
    // searching — keeps normal homepage loads light and fast.
    getPostsLight(!!q?.trim()),
    getAboutPage(),
    getLately(),
    getWelcome(),
  ]);

  const posts = postsResult.status === "fulfilled" ? postsResult.value : [];
  let aboutParagraphs: string[] = [];
  if (aboutResult.status === "fulfilled" && aboutResult.value?.body) {
    const texts = ptToParagraphs(aboutResult.value.body);
    if (texts.length > 0) aboutParagraphs = texts;
  }
  const lately = latelyResult.status === "fulfilled" ? latelyResult.value : null;
  const welcome = welcomeResult.status === "fulfilled" ? welcomeResult.value : null;
  return (<><PageVisitTracker label="Home" /><HomeClient posts={posts} aboutParagraphs={aboutParagraphs} lately={lately} welcome={welcome} initialTab={initialTab} searchQuery={q ?? ""} /></>);
}
