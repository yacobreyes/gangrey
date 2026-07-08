import fs from "fs";
import path from "path";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isSqliteBackend, sqliteMediaDir } from "@/lib/storage/sqlite";

// Serves uploaded media on the self-hosted backend. Uploads land in
// DATA_DIR/media at runtime (outside the build), so they can't be served as
// static files — this route streams them (resizing/cropping on request via
// sharp, cached to disk) with long-lived caching. On Sanity this path is unused.

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml",
};

function parseCrop(v: string | null): { x: number; y: number; w: number; h: number } | null {
  if (!v) return null;
  const [x, y, w, h] = v.split(",").map(Number);
  if ([x, y, w, h].some(n => !Number.isFinite(n)) || w <= 0 || h <= 0) return null;
  return { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1, w), h: Math.min(1, h) };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (!isSqliteBackend()) return new NextResponse("Not found", { status: 404 });
  const { path: parts } = await params;
  const name = (parts ?? []).join("/");
  if (!name || name.includes("..") || name.includes("/")) return new NextResponse("Not found", { status: 404 });
  const file = path.join(sqliteMediaDir(), name);
  if (!fs.existsSync(file)) return new NextResponse("Not found", { status: 404 });

  const ext = path.extname(name).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";

  const sp = req.nextUrl.searchParams;
  const w = Number(sp.get("w")) || 0;
  const h = Number(sp.get("h")) || 0;
  const crop = parseCrop(sp.get("crop"));
  // prog=0 → baseline JPEG. The hero uses this: a progressive JPEG's first pass
  // is a full-frame blurry color wash that reads as a "flash" on a large warm
  // photo. Baseline paints without that averaged-color pre-render.
  const progressive = sp.get("prog") !== "0";

  // Content-negotiate WebP. WebP is ~25-35% smaller than JPEG at the same visual
  // quality, so on a slow connection the photo lands sooner. We only serve it
  // when the client advertises support via Accept (all current browsers do;
  // Gmail's image proxy does too — older desktop mail clients that don't fall
  // back to JPEG automatically). PNG sources stay PNG to preserve transparency.
  const wantsWebp = (req.headers.get("accept") ?? "").includes("image/webp") && ext !== ".png";

  const passHeaders = { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" };

  // No transform requested, or a non-raster format — serve the original bytes.
  if ((!w && !h && !crop) || ext === ".svg" || ext === ".gif") {
    try { return new NextResponse(new Uint8Array(fs.readFileSync(file)), { headers: passHeaders }); }
    catch { return new NextResponse("Not found", { status: 404 }); }
  }

  // The chosen output format decides both the cache filename and the response
  // Content-Type, so WebP and JPEG/PNG derivatives cache side by side and a
  // client always gets bytes whose header matches them.
  const outExt = wantsWebp ? ".webp" : (ext === ".png" ? ".png" : ".jpg");
  const headers = { "Content-Type": MIME[outExt], "Cache-Control": "public, max-age=31536000, immutable", "Vary": "Accept" };

  // Cache derivatives on disk so each size/crop/format is processed once.
  const cacheDir = path.join(sqliteMediaDir(), ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = crypto.createHash("sha1").update(`${name}|${w}|${h}|${sp.get("crop") ?? ""}|p${progressive ? 1 : 0}|${outExt}`).digest("hex");
  const cached = path.join(cacheDir, `${key}${outExt}`);
  if (fs.existsSync(cached)) {
    return new NextResponse(new Uint8Array(fs.readFileSync(cached)), { headers });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require("sharp");
    let img = sharp(file, { failOn: "none" });
    if (crop) {
      const meta = await img.metadata();
      const W = meta.width ?? 0, H = meta.height ?? 0;
      if (W && H) {
        const left = Math.round(crop.x * W);
        const top = Math.round(crop.y * H);
        const cw = Math.min(Math.round(crop.w * W), W - left);
        const ch = Math.min(Math.round(crop.h * H), H - top);
        if (cw > 0 && ch > 0) img = img.extract({ left, top, width: cw, height: ch });
      }
    }
    if (w || h) img = img.resize(w || null, h || null, { fit: "cover" });
    const out = wantsWebp
      // effort:4 is sharp's balance point — noticeably smaller than the default
      // without the encode-time blowup of effort:6 on a 2-vCPU box.
      ? await img.webp({ quality: 78, effort: 4 }).toBuffer()
      : ext === ".png"
      ? await img.png({ compressionLevel: 6 }).toBuffer()
      // libjpeg-turbo (mozjpeg:false) encodes several times faster than mozjpeg
      // for ~5% larger files — a good trade on a 2-vCPU box, since the *first*
      // request for each size generates on demand and the reader waits for it.
      : await img.jpeg({ quality: 80, mozjpeg: false, progressive }).toBuffer();
    fs.writeFileSync(cached, out);
    return new NextResponse(new Uint8Array(out), { headers });
  } catch {
    // Fall back to the original on any processing error.
    try { return new NextResponse(new Uint8Array(fs.readFileSync(file)), { headers: passHeaders }); }
    catch { return new NextResponse("Not found", { status: 404 }); }
  }
}
