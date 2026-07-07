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
  const headers = { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" };

  const sp = req.nextUrl.searchParams;
  const w = Number(sp.get("w")) || 0;
  const h = Number(sp.get("h")) || 0;
  const crop = parseCrop(sp.get("crop"));
  // prog=0 → baseline JPEG. The hero uses this: a progressive JPEG's first pass
  // is a full-frame blurry color wash that reads as a "flash" on a large warm
  // photo. Baseline paints without that averaged-color pre-render.
  const progressive = sp.get("prog") !== "0";

  // No transform requested, or a non-raster format — serve the original bytes.
  if ((!w && !h && !crop) || ext === ".svg" || ext === ".gif") {
    try { return new NextResponse(new Uint8Array(fs.readFileSync(file)), { headers }); }
    catch { return new NextResponse("Not found", { status: 404 }); }
  }

  // Cache derivatives on disk so each size/crop is processed once.
  const cacheDir = path.join(sqliteMediaDir(), ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = crypto.createHash("sha1").update(`${name}|${w}|${h}|${sp.get("crop") ?? ""}|p${progressive ? 1 : 0}`).digest("hex");
  const cached = path.join(cacheDir, `${key}${ext === ".png" ? ".png" : ".jpg"}`);
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
    const out = ext === ".png"
      ? await img.png().toBuffer()
      // progressive renders coarse-to-sharp as bytes arrive (smooth for small
      // cards); baseline (prog=0) avoids the full-frame color pre-render that
      // reads as a flash on the large hero.
      : await img.jpeg({ quality: 82, mozjpeg: true, progressive }).toBuffer();
    fs.writeFileSync(cached, out);
    return new NextResponse(new Uint8Array(out), { headers });
  } catch {
    // Fall back to the original on any processing error.
    try { return new NextResponse(new Uint8Array(fs.readFileSync(file)), { headers }); }
    catch { return new NextResponse("Not found", { status: 404 }); }
  }
}
