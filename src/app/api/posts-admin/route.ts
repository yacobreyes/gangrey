import { getAllPostsAdmin, getArchivePostsAdmin } from "@/lib/sanity";
import { isAuthed } from "@/lib/adminAuth";
import { client } from "@/lib/sanity";
import { isSqliteBackend, sqliteGetPost } from "@/lib/storage/sqlite";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ONE_POST_QUERY = `*[_type == "post" && slug.current == $slug][0]{
  _id, "slug": slug.current, section, headline, subheadline, byline, date, body,
  image { asset, "url": asset->url, caption, alt }, status, scheduledAt, readingTime
}`;

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json([], { status: 401 });
  const slug = req.nextUrl.searchParams.get("slug");
  const archive = req.nextUrl.searchParams.get("archive");
  try {
    // Single-post fetch (with body) for the view-mode live-sync poll.
    if (slug) {
      const post = isSqliteBackend()
        ? sqliteGetPost(slug)
        : await client.fetch(ONE_POST_QUERY, { slug }, { cache: "no-store" });
      return NextResponse.json(post ? [post] : []);
    }
    // Archive pieces only — lazy-loaded by the dashboard's Archive tab.
    if (archive) {
      return NextResponse.json(await getArchivePostsAdmin());
    }
    // Full searchable payload — the dashboard hydrates this after its fast,
    // body-free first paint so client-side search works. Exclude the bulk
    // Archive imports, matching the server render.
    const posts = await getAllPostsAdmin(true, true);
    return NextResponse.json(posts);
  } catch {
    return NextResponse.json([]);
  }
}
