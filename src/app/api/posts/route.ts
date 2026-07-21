import { getAllPosts } from "@/lib/content";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const posts = await getAllPosts();
    return NextResponse.json(posts);
  } catch {
    return NextResponse.json([]);
  }
}
