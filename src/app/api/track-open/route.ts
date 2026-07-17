import { NextRequest, NextResponse } from "next/server";
import { sqliteGetDoc, sqliteDocsByType, sqliteMutate } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF — each sent email embeds this pixel with the
// subscriber's id and that send's newsletter id, so we can tell which sends
// a subscriber actually opened (not just whether they opened one, ever).
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

// Status rule (kept consistent with getEngagement in newsletterActions):
// judged on sends since the subscriber joined, only once 3+ exist. Opening
// 50%+ of them = active, under 50% = inactive; before that, neutral.
function classifyByOpens(openedCount: number, sendCount: number): "active" | "neutral" | "inactive" {
  if (sendCount < 3) return "neutral";
  return openedCount / sendCount >= 0.5 ? "active" : "inactive";
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const nid = req.nextUrl.searchParams.get("nid");

  if (id && nid) {
    try {
      const sub = sqliteGetDoc<{ openedSends?: string[]; createdAt?: string }>(id);
      if (sub) {
        const openedSends = Array.from(new Set([...(sub.openedSends ?? []), nid])).slice(-20);

        // Sends since this subscriber joined; their percentage is judged
        // against these, not the full history from before they existed.
        const since = sqliteDocsByType<{ _id: string; status?: string; sentAt?: string }>("newsletter")
          .filter(n => n.status === "published" && !!n.sentAt && (!sub.createdAt || (n.sentAt ?? "") >= sub.createdAt))
          .map(n => n._id);
        const openedCount = since.filter(sid => openedSends.includes(sid)).length;
        const status = classifyByOpens(openedCount, since.length);

        sqliteMutate([{ patch: { id, set: { status, openedSends, lastOpenedAt: new Date().toISOString() } } }]);
      }
    } catch {
      // Subscriber may have been removed since the email was sent — ignore.
    }
  }

  return new NextResponse(PIXEL, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
}
