import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isCurrentVisitorActiveMember } from "@/lib/currentMember";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org";

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

  // Escape hatch. The mirror is the old site verbatim, so it has no link back
  // to today's Gangrey: once inside, only the browser's back button got you
  // out. Inject a small fixed bar into every HTML page (assets untouched).
  // Body-bottom padding keeps it from covering the old footer.
  if (ext === ".html") {
    const bar = `<div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#490000;color:#fff;display:flex;align-items:center;justify-content:center;padding:9px 14px calc(9px + env(safe-area-inset-bottom,0px));font:700 11px/1.5 'Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;box-shadow:0 -2px 10px rgba(0,0,0,.25)"><span>You are reading the original Gangrey blog&nbsp;&middot;&nbsp;<a href="/archive" style="color:#fff;text-decoration:underline;text-underline-offset:3px">Back to the Archive</a></span></div><style>body{padding-bottom:52px !important}</style>`;
    let html = fs.readFileSync(file, "utf8");
    html = html.includes("</body>") ? html.replace("</body>", `${bar}</body>`) : html + bar;
    return new NextResponse(html, {
      headers: {
        "Content-Type": MIME[ext],
        "Cache-Control": "private, no-cache",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
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
