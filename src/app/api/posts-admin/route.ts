import { getAllPostsAdmin, getArchivePostsAdmin } from "@/lib/sanity";
import { isAuthed } from "@/lib/adminAuth";
import { sqliteGetPost } from "@/lib/storage/sqlite";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json([], { status: 401 });
  const slug = req.nextUrl.searchParams.get("slug");
  const archive = req.nextUrl.searchParams.get("archive");
  try {
    // Single-post fetch (with body) for the view-mode live-sync poll.
    if (slug) {
      const post = sqliteGetPost(slug);
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
