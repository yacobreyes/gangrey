"use client";
import { useState, useMemo } from "react";
import Link from "next/link";

type Post = {
  _id: string;
  headline: string;
  slug: string;
  date: string;
  byline?: string;
  body: unknown[];
  status?: string;
  scheduledAt?: string;
  section?: string;
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
function truncate(s: string, n = 180) { return s.length <= n ? s : s.slice(0, n).trimEnd() + "…"; }
function plainText(body: unknown[]): string {
  return (body as { children?: { text?: string }[] }[])
    .flatMap(b => b.children?.map(c => c.text ?? "") ?? [])
    .join(" ").replace(/\s+/g, " ").trim();
}
function readingTime(body: unknown[]) {
  const words = plainText(body).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export default function GangreyArchive({ posts }: { posts: Post[] }) {
  const [query, setQuery] = useState("");
  const [activeYear, setActiveYear] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter(p => {
      if (activeYear && new Date(p.date).getUTCFullYear().toString() !== activeYear) return false;
      if (!q) return true;
      return p.headline.toLowerCase().includes(q) ||
        (p.byline ?? "").toLowerCase().includes(q) ||
        plainText(p.body).toLowerCase().includes(q);
    });
  }, [posts, query, activeYear]);

  const byYear: Record<string, Post[]> = {};
  for (const p of filtered) {
    const y = new Date(p.date).getUTCFullYear().toString();
    (byYear[y] = byYear[y] ?? []).push(p);
  }
  const years = Object.keys(byYear).sort((a, b) => +b - +a);
  const allYears = [...new Set(posts.map(p => new Date(p.date).getUTCFullYear().toString()))].sort((a,b)=>+b-+a);
  const countByYear: Record<string, number> = {};
  for (const p of posts) {
    const y = new Date(p.date).getUTCFullYear().toString();
    countByYear[y] = (countByYear[y] ?? 0) + 1;
  }
  const searching = query.trim().length > 0 || activeYear !== null;
  // With 3,000+ posts spanning 11 years, dumping every year into one long
  // scroll meant the only way to reach, say, 2009 was to drag the scrollbar
  // past everything else first. Land on the year picker instead; a year's
  // stories render only once you click it (or search matches across all of
  // them regardless of year).
  const browsing = !searching;

  return (
    <>
      <style>{`
        .gr-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
        .gr-search-wrap { position: relative; flex: 1 1 220px; max-width: 340px; }
        .gr-search { width: 100%; box-sizing: border-box; font-family: var(--font-subhead); font-size: 13px; padding: 8px 32px 8px 12px; border: 1px solid #b8b8ba; border-radius: 2px; background: #ffffff; color: #000000; outline: none; }
        .gr-search:focus { border-color: #490000; }
        .gr-search-clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: #392a22; font-size: 16px; line-height: 1; padding: 0; }
        .gr-year-nav { display: flex; flex-wrap: wrap; gap: 6px 4px; }
        .gr-year-btn { font-family: var(--font-subhead); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #000000; background: none; padding: 5px 10px; border: 1px solid #b8b8ba; border-radius: 2px; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
        .gr-year-btn:hover { background: #ffffff; border-color: #392a22; }
        .gr-year-btn.active { background: #490000; color: #fff; border-color: #490000; }
        .gr-no-results { font-family: var(--font-headline); font-size: 22px; font-style: italic; color: #000000; margin-top: 48px; }

        .gr-picker { margin-top: 48px; }
        .gr-picker-hint { font-family: var(--font-subhead); font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #392a22; margin: 0 0 20px; }
        .gr-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
        .gr-picker-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; background: none; border: 1px solid #b8b8ba; border-radius: 2px; padding: 16px 18px; cursor: pointer; text-align: left; transition: border-color .15s, background .15s; }
        .gr-picker-btn:hover { border-color: #490000; background: #ffffff; }
        .gr-picker-year { font-family: var(--font-headline); font-size: 28px; font-weight: 800; color: #490000; letter-spacing: -.02em; line-height: 1; }
        .gr-picker-count { font-family: var(--font-subhead); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #392a22; }
        @media (max-width: 900px) {
          .gr-picker-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
        }

        .gr-year-block { display: grid; grid-template-columns: 110px 1fr; gap: 0 48px; }
        .gr-year-block + .gr-year-block { border-top: 1px solid #b8b8ba; }
        .gr-year-col { padding-top: 32px; }
        .gr-year-label { font-family: var(--font-headline); font-size: 56px; font-weight: 800; line-height: 1; color: #490000; letter-spacing: -.04em; position: sticky; top: 20px; }
        .gr-stories { border-left: 1px solid #b8b8ba; }
        .gr-row { display: grid; grid-template-columns: 1fr auto; gap: 0 32px; padding: 28px 0 28px 40px; border-bottom: 1px solid #b8b8ba; align-items: start; transition: background .15s; }
        .gr-row:hover { background: #ffffff; }
        .gr-row:last-child { border-bottom: none; }
        .gr-date { font-family: var(--font-subhead); font-size: 11px; font-weight: 700; letter-spacing: .1em; color: #392a22; text-transform: uppercase; margin-bottom: 10px; }
        .gr-headline { font-family: var(--font-headline); font-size: clamp(24px, 3.4vw, 31px); font-weight: 800; line-height: 1.05; letter-spacing: -.02em; color: #000000; text-decoration: none; display: block; margin-bottom: 6px; transition: color .15s; }
        .gr-row:hover .gr-headline { color: #490000; }
        .gr-byline { font-family: var(--font-headline); font-size: 17px; font-style: italic; color: #000000; margin-bottom: 10px; }
        .gr-excerpt { font-family: var(--font-headline); font-size: 16.5px; line-height: 1.55; color: #392a22; margin: 0; }
        .gr-row-right { padding-top: 4px; text-align: right; white-space: nowrap; }
        .gr-time { font-family: var(--font-subhead); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #490000; }
        .gr-search-count { font-family: var(--font-subhead); font-size: 12px; color: #392a22; letter-spacing: .06em; }

        @media (max-width: 900px) {
          .gr-year-block { grid-template-columns: 1fr; gap: 0; }
          .gr-year-col { padding-top: 24px; padding-bottom: 8px; }
          .gr-year-label { font-size: 40px; position: static; }
          .gr-stories { border-left: none; border-top: 1px solid #b8b8ba; }
          .gr-row { padding: 20px 0; grid-template-columns: 1fr; gap: 8px; }
          .gr-row:hover { background: transparent; }
          .gr-row-right { text-align: left; }
          .gr-search-wrap { max-width: 100%; }
        }
      `}</style>

      <div className="gr-controls">
        <div className="gr-search-wrap">
          <input
            className="gr-search"
            type="search"
            placeholder="Search stories…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search Gangrey stories"
          />
          {query && (
            <button className="gr-search-clear" onClick={() => setQuery("")} aria-label="Clear search">×</button>
          )}
        </div>
        {/* The year buttons only need to show once you're past the initial
            picker — showing them there too would just duplicate it. */}
        {!browsing && allYears.length > 1 && (
          <nav className="gr-year-nav" aria-label="Filter by year">
            {activeYear && (
              <button className="gr-year-btn" onClick={() => setActiveYear(null)}>← All years</button>
            )}
            {allYears.map(y => (
              <button
                key={y}
                className={`gr-year-btn${activeYear === y ? " active" : ""}`}
                onClick={() => setActiveYear(activeYear === y ? null : y)}
                aria-pressed={activeYear === y}
              >{y}</button>
            ))}
          </nav>
        )}
        {searching && (
          <span className="gr-search-count">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {browsing ? (
        <div className="gr-picker">
          <p className="gr-picker-hint">Pick a year to browse — or search above</p>
          <div className="gr-picker-grid">
            {allYears.map(y => (
              <button key={y} className="gr-picker-btn" onClick={() => setActiveYear(y)}>
                <span className="gr-picker-year">{y}</span>
                <span className="gr-picker-count">{countByYear[y]} {countByYear[y] === 1 ? "story" : "stories"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
      <div style={{ marginTop: 48 }}>
        {filtered.length === 0
          ? <p className="gr-no-results">No stories{activeYear ? ` from ${activeYear}` : ""}{query.trim() ? ` matching "${query.trim()}"` : ""}.</p>
          : years.map(year => (
            <div key={year} id={`year-${year}`} className="gr-year-block">
              <div className="gr-year-col">
                <div className="gr-year-label">{year}</div>
              </div>
              <div className="gr-stories">
                {byYear[year].map(post => {
                  const plain = truncate(plainText(post.body));
                  return (
                    <div key={post._id} className="gr-row">
                      <div className="gr-row-left">
                        <div className="gr-date">{fmtDate(post.date)}</div>
                        <Link href={`/stories/${post.slug}`} className="gr-headline">{post.headline}</Link>
                        {post.byline && <div className="gr-byline">By {post.byline}</div>}
                        {plain && <p className="gr-excerpt">{plain}</p>}
                      </div>
                      <div className="gr-row-right">
                        <div className="gr-time">{readingTime(post.body)} min</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        }
      </div>
      )}
    </>
  );
}
