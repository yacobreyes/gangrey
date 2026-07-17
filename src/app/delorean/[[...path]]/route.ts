import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isCurrentVisitorActiveMember } from "@/lib/currentMember";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org";

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
  // Members-only perk: the archive gates its stories behind membership, and
  // the DeLorean carries all the same writing — leaving it open would be a
  // paywall bypass. Non-members go to the subscribe page.
  if (!(await isCurrentVisitorActiveMember())) {
    // Redirect against the PUBLIC origin, never req.url — behind the reverse
    // proxy req.url carries the container's internal hostname, and a 302 to
    // http://<container-id>:3000/... is a dead end for the browser.
    return NextResponse.redirect(new URL("/subscribe", SITE_URL), 302);
  }
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
    return NextResponse.redirect(new URL("/delorean/", SITE_URL), 302);
  }

  const ext = path.extname(file).toLowerCase();
  let body: Buffer | Uint8Array = fs.readFileSync(file);
  if (ext === ".html") {
    // Strip the mirrored WordPress credit footer ("Proudly powered by
    // WordPress" / the wordpress.org link) at serve time, since the mirror
    // files themselves are a faithful snapshot.
    const html = body.toString("utf-8")
      .replace(/<footer[^>]*id=["']colophon["'][\s\S]*?<\/footer>/gi, "")
      .replace(/<div[^>]*class=["'][^"']*site-info[^"']*["'][\s\S]*?<\/div>/gi, "")
      .replace(/<a[^>]*href=["'][^"']*wordpress\.org[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "");
    body = Buffer.from(html, "utf-8");
  }
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      // Member-gated: must never be cached publicly or served without a
      // revalidation request — a cached copy would bypass the 302-to-subscribe
      // gate entirely (browsers kept serving pages cached before the gate).
      "Cache-Control": "private, no-cache",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
