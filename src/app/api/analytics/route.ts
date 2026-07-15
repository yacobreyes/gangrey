import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import {
  sqliteAnalyticsOverview, sqliteAnalyticsSeries, sqliteAnalyticsTopContent,
  sqliteAnalyticsBreakdown, sqliteAnalyticsRealtime, sqliteAnalyticsTrending,
  sqliteAllPostsAdminLight,
} from "@/lib/storage/sqlite";

// Admin-only analytics dashboard data. One call returns everything the panel
// needs for the selected time range.
export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    // Rolling ranges are aligned to the viewer's local calendar days ending
    // with TODAY — so today gets its own bar (rightmost) and every bucket is a
    // real calendar day, not an unaligned 24h slice that buries today in the
    // previous day's bucket.
    rangeKey = req.nextUrl.searchParams.get("range") ?? "7d";
    const days = RANGE_DAYS[rangeKey] ?? 7;
    const shifted = new Date(Date.now() - tz * 60_000); // its UTC fields = viewer-local Y/M/D
    const todayMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + tz * 60_000;
    until = todayMidnight + 86400_000;              // end of today (local)
    since = todayMidnight - (days - 1) * 86400_000; // start of the first day in range
    buckets = days;
  }
  const prevSince = since - (until - since); // equal-length prior window, for deltas

  // Optional author filter: every number on the panel narrows to stories whose
  // current byline matches (see AUTHOR_COND in sqlite.ts). The `authors`
  // breakdown itself stays UNFILTERED so the picker always lists everyone.
  const author = (req.nextUrl.searchParams.get("author") ?? "").trim() || undefined;

  // Headline titles so the UI can label slugs without a second round-trip.
  const titleBySlug: Record<string, string> = {};
  for (const p of sqliteAllPostsAdminLight()) titleBySlug[p.slug] = p.headline;

  const overview = sqliteAnalyticsOverview(since, until, author);
  const prev = sqliteAnalyticsOverview(prevSince, since, author);
  const pctDelta = (cur: number, was: number) => was > 0 ? Math.round(((cur - was) / was) * 100) : (cur > 0 ? 100 : 0);

  const authorStoryCount = author
    ? sqliteAllPostsAdminLight().filter(p => (p.byline ?? "").trim() === author).length
    : 0;

  return NextResponse.json({
    range: rangeKey,
    author: author ?? null,
    authorStoryCount,
    overview: {
      ...overview,
      viewsDelta: pctDelta(overview.views, prev.views),
      visitorsDelta: pctDelta(overview.visitors, prev.visitors),
      engagedDelta: pctDelta(overview.avgEngagedMs, prev.avgEngagedMs),
    },
    since, until, buckets,
    series: sqliteAnalyticsSeries(since, until, buckets, author),
    // Same bucket count over the immediately-prior equal-length window, so the
    // chart can overlay day-over-day / week-over-week / month-over-month.
    prevSeries: sqliteAnalyticsSeries(prevSince, since, buckets, author),
    // Only surface stories that still exist (a slug in titleBySlug) — otherwise
    // rows from deleted/renamed posts show a bare slug and 404 on click.
    top: sqliteAnalyticsTopContent(since, until, 40, author).filter(t => t.slug in titleBySlug).slice(0, 10).map(t => ({ ...t, title: titleBySlug[t.slug] })),
    sources: sqliteAnalyticsBreakdown("source", since, until, 10, author),
    sections: sqliteAnalyticsBreakdown("section", since, until, 10, author),
    authors: sqliteAnalyticsBreakdown("byline", since, until, 50),
    devices: sqliteAnalyticsBreakdown("device", since, until, 5, author),
    trending: sqliteAnalyticsTrending(16, author).filter(t => t.slug in titleBySlug).slice(0, 8).map(t => ({ ...t, title: titleBySlug[t.slug] })),
    realtime: (() => {
      const rt = sqliteAnalyticsRealtime(undefined, author);
      return { active: rt.active, reading: rt.reading.filter(r => r.slug in titleBySlug).map(r => ({ ...r, title: titleBySlug[r.slug] })) };
    })(),
  });
}
