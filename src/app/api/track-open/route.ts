import { NextRequest, NextResponse } from "next/server";
import { sqliteGetDoc, sqliteDocsByType, sqliteMutate } from "@/lib/storage/sqlite";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF — each sent email embeds this pixel with the
// subscriber's id and that send's newsletter id, so we can tell which sends
// a subscriber actually opened (not just whether they opened one, ever).
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

// "active" = opened at least REQUIRED of the last LOOKBACK sends.
// "inactive" = opened none of them (despite LOOKBACK sends having gone out).
// "neutral" = everything in between. Kept consistent with classifyByOpens()
// in src/app/admin/newsletterActions.ts.
const LOOKBACK = 3;
const REQUIRED = 2;
function classifyByOpens(openedCount: number, lookbackCount: number): "active" | "neutral" | "inactive" {
  if (lookbackCount === 0) return "neutral";
  if (openedCount >= REQUIRED) return "active";
  if (openedCount >= 1) return "neutral";
  return "inactive";
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const nid = req.nextUrl.searchParams.get("nid");

  if (id && nid) {
    try {
      const sub = sqliteGetDoc<{ openedSends?: string[] }>(id);
      if (sub) {
        const openedSends = Array.from(new Set([...(sub.openedSends ?? []), nid])).slice(-20);

        const recentSends = sqliteDocsByType<{ _id: string; status?: string; sentAt?: string }>("newsletter")
          .filter(n => n.status === "published")
          .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
          .slice(0, LOOKBACK)
          .map(n => n._id);
        const openedRecent = recentSends.filter(sid => openedSends.includes(sid)).length;
        const status = classifyByOpens(openedRecent, recentSends.length);

        sqliteMutate([{ patch: { id, set: { status, openedSends, lastOpenedAt: new Date().toISOString() } } }]);
      }
    } catch {
      // Subscriber may have been removed since the email was sent — ignore.
    }
  }

  return new NextResponse(PIXEL, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
}
