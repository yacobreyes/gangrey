import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isSqliteBackend, sqliteMediaDir } from "@/lib/storage/sqlite";

// Serves uploaded media on the self-hosted backend. Uploads land in
// DATA_DIR/media at runtime (outside the build), so they can't be served as
// static files — this route streams them with long-lived caching instead.
// On the Sanity backend this path is never linked to.

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (!isSqliteBackend()) return new NextResponse("Not found", { status: 404 });
  const { path: parts } = await params;
  const name = (parts ?? []).join("/");
  if (!name || name.includes("..") || name.includes("/")) return new NextResponse("Not found", { status: 404 });
  const file = path.join(sqliteMediaDir(), name);
  try {
    const buf = fs.readFileSync(file);
    const type = MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
