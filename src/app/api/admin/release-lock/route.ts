import { NextRequest, NextResponse } from "next/server";
import { releaseLock } from "@/app/admin/lockActions";
import { isAuthed } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

// Beacon target for releasing an edit lock on page-hide / navigation. Using a
// route (hit via navigator.sendBeacon) instead of the server action directly
// means the release survives a hard navigation away from the editor, so the
// lock clears immediately instead of waiting out its TTL.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    let body: { targetId?: string; sessionId?: string } = {};
    try { body = await req.json(); }
    catch { try { body = JSON.parse(await req.text()); } catch { body = {}; } }
    if (body.targetId && body.sessionId) {
      await releaseLock(body.targetId, body.sessionId);
    }
  } catch { /* best-effort */ }
  return NextResponse.json({ ok: true });
}
