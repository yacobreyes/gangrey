import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

// Serves the DeLorean — the static mirror of the old gangrey.com (snapshot
// nearest 2016-12-17) that scripts/build-delorean.mjs writes to
// DATA_DIR/delorean. Querystring routes were flattened to directories at
// build time (/?p=5 → p/5/index.html), so this is plain file serving with
// directory-index resolution.

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".ico": "image/x-icon", ".svg": "image/svg+xml", ".xml": "text/xml",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

function mirrorRoot(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "delorean");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path: parts } = await params;
  const rel = (parts ?? []).join("/");
  if (rel.includes("..")) return new NextResponse("Not found", { status: 404 });

  const root = mirrorRoot();
  let file = path.join(root, rel);
  // Directory-style URLs resolve to their index.html.
  if (!rel || rel.endsWith("/")) file = path.join(root, rel, "index.html");
  else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  else if (!fs.existsSync(file) && fs.existsSync(path.join(root, rel, "index.html"))) file = path.join(root, rel, "index.html");

  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // The mirror hasn't been built yet, or a hole in the capture — send the
    // time traveler home rather than 404 into the void.
    if (!fs.existsSync(path.join(root, "index.html"))) {
      return new NextResponse("The DeLorean isn't built yet — run scripts/build-delorean.mjs on the server.", { status: 503 });
    }
    return NextResponse.redirect(new URL("/delorean/", req.url), 302);
  }

  const ext = path.extname(file).toLowerCase();
  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
