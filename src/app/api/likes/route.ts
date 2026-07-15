import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { sqliteGetCount, sqliteIncrementCount } from "@/lib/storage/sqlite";

function likeId(slug: string) {
  return `likes-${slug.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ count: 0 });
  return NextResponse.json({ count: sqliteGetCount(likeId(slug)) });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(ip, "likes", 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const { slug, delta } = await req.json() as { slug: string; delta: 1 | -1 };
  if (!slug || (delta !== 1 && delta !== -1)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const id = likeId(slug);

  return NextResponse.json({ count: sqliteIncrementCount(id, delta) });
}
