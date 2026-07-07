import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/adminAuth";
import {
  isSqliteBackend,
  sqliteAnalyticsOverview, sqliteAnalyticsSeries, sqliteAnalyticsTopContent,
  sqliteAnalyticsBreakdown, sqliteAnalyticsRealtime, sqliteAnalyticsTrending,
  sqliteAllPostsAdmin,
} from "@/lib/storage/sqlite";

// Admin-only analytics dashboard data. One call returns everything the panel
// needs for the selected time range.
export const dynamic = "force-dynamic";

const RANGES: Record<string, { ms: number; buckets: number }> = {
  today: { ms: 24 * 3600_000, buckets: 24 },
  "7d": { ms: 7 * 86400_000, buckets: 7 },
  "30d": { ms: 30 * 86400_000, buckets: 30 },
  "90d": { ms: 90 * 86400_000, buckets: 30 },
};

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSqliteBackend()) return NextResponse.json({ error: "Analytics is only available on the self-hosted backend." }, { status: 400 });

  const rangeKey = req.nextUrl.searchParams.get("range") ?? "7d";
  const { ms, buckets } = RANGES[rangeKey] ?? RANGES["7d"];
  const until = Date.now();
  const since = until - ms;
  const prevSince = since - ms; // previous equal window, for deltas

  // Headline titles so the UI can label slugs without a second round-trip.
  const titleBySlug: Record<string, string> = {};
  for (const p of sqliteAllPostsAdmin()) titleBySlug[p.slug] = p.headline;

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
    series: sqliteAnalyticsSeries(since, until, buckets),
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
