import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { recordingFilePath } from "@/lib/recordingStore";

// Serves the standalone /recording bundle from the DATA_DIR copy (editable in
// /admin/recording, survives deploys), falling back to the bundled file. This
// route supersedes the old rewrite to /public/recording.html.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let file: string;
  try {
    file = recordingFilePath();
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  let body: Buffer;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
    body = fs.readFileSync(file);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  // The bundle is ~7MB, so avoid re-sending it when nothing changed — but a
  // fresh edit must show on the next refresh. no-cache forces revalidation and
  // the mtime/size ETag answers 304 while the file is unchanged.
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "ETag": etag,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
