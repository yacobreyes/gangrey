import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import {
  isSqliteBackend,
  sqliteAnalyticsOverview, sqliteAnalyticsSeries, sqliteAnalyticsTopContent,
  sqliteAnalyticsBreakdown, sqliteAnalyticsRealtime, sqliteAnalyticsTrending,
  sqliteAllPostsAdminLight,
} from "@/lib/storage/sqlite";

// Admin-only analytics dashboard data. One call returns everything the panel
// needs for the selected time range.
export const dynamic = "force-dynamic";

const RANGES: Record<string, { ms: number; buckets: number }> = {
  "7d": { ms: 7 * 86400_000, buckets: 7 },
  "30d": { ms: 30 * 86400_000, buckets: 30 },
  "90d": { ms: 90 * 86400_000, buckets: 30 },
};

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSqliteBackend()) return NextResponse.json({ error: "Analytics is only available on the self-hosted backend." }, { status: 400 });

  // A specific calendar day (?date=YYYY-MM-DD) — e.g. "how did I do yesterday" —
  // takes priority over the rolling-window ranges below. Hourly buckets, and
  // the comparison window is the single day before it, so "vs previous period"
  // means "vs the day before," not an arbitrary equal-length window.
  // tz = the viewer's getTimezoneOffset() in minutes (positive when behind UTC,
  // e.g. 240 for EDT). Day windows are computed in the viewer's local time, not
  // the server's UTC, so "today"/"yesterday" and the hour buckets line up with
  // the reader's actual calendar day.
  const tz = Number(req.nextUrl.searchParams.get("tz") ?? "0") || 0;
  const dateParam = req.nextUrl.searchParams.get("date");
  let rangeKey: string, since: number, until: number, buckets: number;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split("-").map(Number);
    since = Date.UTC(y, m - 1, d) + tz * 60_000; // local midnight of that date
    until = since + 86400_000;                   // full 24h; future hours read as 0
    buckets = 24;
    rangeKey = dateParam;
  } else {
    rangeKey = req.nextUrl.searchParams.get("range") ?? "7d";
    const r = RANGES[rangeKey] ?? RANGES["7d"];
    until = Date.now();
    since = until - r.ms;
    buckets = r.buckets;
  }
  const prevSince = since - (until - since); // equal-length prior window, for deltas

  // Headline titles so the UI can label slugs without a second round-trip.
  const titleBySlug: Record<string, string> = {};
  for (const p of sqliteAllPostsAdminLight()) titleBySlug[p.slug] = p.headline;

  const overview = sqliteAnalyticsOverview(since, until);
  const prev = sqliteAnalyticsOverview(prevSince, since);
  const pctDelta = (cur: number, was: number) => was > 0 ? Math.round(((cur - was) / was) * 100) : (cur > 0 ? 100 : 0);

  return NextResponse.json({
    range: rangeKey,
    overview: {
      ...overview,
      viewsDelta: pctDelta(overview.views, prev.views),
      visitorsDelta: pctDelta(overview.visitors, prev.visitors),
      engagedDelta: pctDelta(overview.avgEngagedMs, prev.avgEngagedMs),
    },
    since, until, buckets,
    series: sqliteAnalyticsSeries(since, until, buckets),
    // Same bucket count over the immediately-prior equal-length window, so the
    // chart can overlay day-over-day / week-over-week / month-over-month.
    prevSeries: sqliteAnalyticsSeries(prevSince, since, buckets),
    top: sqliteAnalyticsTopContent(since, until, 20).map(t => ({ ...t, title: titleBySlug[t.slug] ?? t.slug })),
    sources: sqliteAnalyticsBreakdown("source", since, until, 10),
    sections: sqliteAnalyticsBreakdown("section", since, until, 10),
    authors: sqliteAnalyticsBreakdown("byline", since, until, 10),
    devices: sqliteAnalyticsBreakdown("device", since, until, 5),
    trending: sqliteAnalyticsTrending(8).map(t => ({ ...t, title: titleBySlug[t.slug] ?? t.slug })),
    realtime: (() => {
      const rt = sqliteAnalyticsRealtime();
      return { active: rt.active, reading: rt.reading.map(r => ({ ...r, title: titleBySlug[r.slug] ?? r.slug })) };
    })(),
  });
}
