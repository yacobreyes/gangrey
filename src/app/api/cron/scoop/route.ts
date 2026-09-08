import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { fetchLatestReport } from "@/lib/scoop/fetch";
import { notify } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a), bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Daily automated pull of the Tampa permits feed. Add to the VPS crontab:
//   15 7 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://www.gangrey.org/api/cron/scoop >> /var/log/scoop-cron.log 2>&1
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || !safeEqual(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const s = await fetchLatestReport();
    // A quiet daily pull isn't worth a phone buzz; new leads are.
    if (!s.alreadyImported && (s.inserted > 0 || s.changed > 0)) {
      notify({
        title: "Tampa permits imported",
        body: `${s.inserted} new, ${s.changed} changed of ${s.rowCount} rows`,
        url: "/admin/imago/scoop",
        tag: "scoop-import",
      });
    }
    return NextResponse.json(s);
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
