import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { recordingFilePath } from "@/lib/recordingStore";
import { FFLATE_UMD } from "@/lib/recording-assets/fflateUmd";

// The bundle's loader gunzips embedded assets with DecompressionStream and,
// when a browser lacks it (older Safari/Firefox, some hardened modes), fell
// through to using the still-compressed bytes: the page died with
// "SyntaxError: Invalid character '\\u001f'" (the gzip magic byte) and a
// cascade of onRootClick ReferenceErrors. Inject a polyfill ahead of the
// loader: fflate's gunzip wrapped in the one write-everything-then-read
// pattern the loader uses. Browsers with the real API never hit it.
const POLYFILL = `<script>${FFLATE_UMD}</script>
<script>
if (typeof DecompressionStream === "undefined") {
  window.DecompressionStream = class {
    constructor(format) {
      var chunks = [];
      var resolveOut; var out = new Promise(function (r) { resolveOut = r; });
      this.writable = { getWriter: function () { return {
        write: function (b) { chunks.push(b instanceof Uint8Array ? b : new Uint8Array(b)); return Promise.resolve(); },
        close: function () {
          var n = 0; for (var i = 0; i < chunks.length; i++) n += chunks[i].length;
          var all = new Uint8Array(n); var o = 0;
          for (var j = 0; j < chunks.length; j++) { all.set(chunks[j], o); o += chunks[j].length; }
          try { resolveOut(format === "gzip" ? fflate.gunzipSync(all) : fflate.inflateSync(all)); }
          catch (e) { resolveOut(null); }
          return Promise.resolve();
        }
      }; } };
      this.readable = { getReader: function () { var done = false; return {
        read: function () { return out.then(function (v) {
          if (done) return { done: true, value: undefined };
          done = true;
          if (v == null) throw new Error("inflate failed");
          return { done: false, value: v };
        }); }
      }; } };
    }
  };
}
</script>`;

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
  // "-p1" = polyfill revision: bumping it invalidates copies cached before
  // the DecompressionStream injection existed.
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}-p1"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }
  // Inject the polyfill ahead of the first script so it's defined before the
  // bundle loader runs.
  let html = body.toString("utf8");
  const firstScript = html.indexOf("<script");
  html = firstScript === -1 ? POLYFILL + html
    : html.slice(0, firstScript) + POLYFILL + html.slice(firstScript);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "ETag": etag,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
