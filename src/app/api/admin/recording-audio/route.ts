import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/adminAuth";
import { getRecordingAsset } from "@/lib/recordingStore";

// Streams one embedded audio asset out of the /recording bundle so the
// admin editor can audition a clip while adjusting its trim/fade timings.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });
  const id = req.nextUrl.searchParams.get("file") ?? "";
  if (!/^assets\/[\w.-]+$/.test(id)) return new NextResponse("Bad request", { status: 400 });
  const asset = getRecordingAsset(id);
  if (!asset) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mime,
      // The underlying audio never changes when timings do, so let the
      // editor cache it for the session.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
