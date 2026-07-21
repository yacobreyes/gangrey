"use client";

import Feed from "@/components/Newspaper";
import type { Post, LatelyContent, WelcomeContent } from "@/lib/content";

type Tab = "Home" | "About" | "Micro-Memoirs" | "Narratives" | "Essays" | "Archive";

export default function HomeClient({ posts, aboutParagraphs, lately, welcome, initialTab, searchQuery }: { posts: Post[]; aboutParagraphs: string[]; lately: LatelyContent | null; welcome: WelcomeContent | null; initialTab: Tab; searchQuery?: string }) {
  return (
    <Feed posts={posts} aboutParagraphs={aboutParagraphs} lately={lately} welcome={welcome} initialTab={initialTab} searchQuery={searchQuery} />
  );
}
