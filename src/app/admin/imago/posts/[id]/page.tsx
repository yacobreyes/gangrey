import { getCurrentUser } from "@/lib/adminAuth";
import { fullName } from "@/lib/users";
import { redirect } from "next/navigation";
import { client } from "@/lib/sanity";
import type { SanityPost } from "@/lib/sanity";
import { isSqliteBackend, sqliteGetPost } from "@/lib/storage/sqlite";
import EditorClient from "../../../EditorClient";

async function loadPost(slug: string): Promise<SanityPost | null> {
  if (isSqliteBackend()) return sqliteGetPost(slug);
  return client.fetch<SanityPost | null>(QUERY, { slug }, { cache: "no-store" });
}

export const dynamic = "force-dynamic";

const QUERY = `*[_type == "post" && slug.current == $slug][0]{
  _id, "slug": slug.current, section, headline, subheadline, byline,
  date, body, image { asset, "url": asset->url, caption, alt }, status, scheduledAt, scheduledBy, readingTime
}`;

export default async function EditPostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/admin/imago");

  // Byline the editor pre-fills onto a brand-new draft: the signed-in user's
  // preferred byline, falling back to their full name.
  const defaultByline = (me.byline?.trim() || fullName(me)) ?? "";

  const { id } = await params;
  const { new: isNewParam } = await searchParams;
  // ?new=1 means the user just created this via "Create new" → open in edit
  // mode. Any other entry (URL paste, second tab, dashboard click) opens in
  // view mode so the user can read over someone's shoulder without claiming.
  const isNew = isNewParam === "1";

  // For new drafts, render immediately with empty state — first auto-save creates the doc
  if (id.startsWith("untitled-")) {
    const existing = await loadPost(id);
    const post: SanityPost = existing ?? {
      _id: `post-${id}`,
      slug: id,
      headline: "",
      subheadline: "",
      byline: "",
      section: "",
      date: new Date().toISOString().slice(0, 10),
      body: [],
      status: "draft",
    };
    return <EditorClient post={post} defaultByline={defaultByline} isNew={isNew} />;
  }

  const post = await loadPost(id);
  if (!post) redirect("/admin/imago");

  return <EditorClient post={post} defaultByline={defaultByline} isNew={isNew} />;
}
