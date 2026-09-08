import { getAllPostsAdmin } from "@/lib/content";
import { isAuthed } from "@/lib/adminAuth";
import { sqliteGetPost } from "@/lib/storage/sqlite";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json([], { status: 401 });
  const slug = req.nextUrl.searchParams.get("slug");
  try {
    // Single-post fetch (with body) for the view-mode live-sync poll.
    if (slug) {
      const post = sqliteGetPost(slug);
      return NextResponse.json(post ? [post] : []);
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
