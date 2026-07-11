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
  const allYears = useMemo(
    () => [...new Set(posts.map(p => new Date(p.date).getUTCFullYear().toString()))].sort((a, b) => +b - +a),
    [posts]
  );
  const [query, setQuery] = useState("");
  // Opens on the most recent year rather than dumping all 3,000+ posts into
  // one long scroll (the only way to reach an earlier year used to be
  // dragging past everything after it).
  const [activeYear, setActiveYear] = useState<string | null>(allYears[0] ?? null);

  const searchMode = query.trim().length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter(p => {
      if (!searchMode) return new Date(p.date).getUTCFullYear().toString() === activeYear;
      return p.headline.toLowerCase().includes(q) ||
        (p.byline ?? "").toLowerCase().includes(q) ||
        plainText(p.body).toLowerCase().includes(q);
    });
  }, [posts, query, activeYear, searchMode]);

  const byYear: Record<string, Post[]> = {};
  for (const p of filtered) {
    const y = new Date(p.date).getUTCFullYear().toString();
    (byYear[y] = byYear[y] ?? []).push(p);
  }
  const years = Object.keys(byYear).sort((a, b) => +b - +a);

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
        {!searchMode && allYears.length > 1 && (
          <nav className="gr-year-nav" aria-label="Filter by year">
            {allYears.map(y => (
              <button
                key={y}
                className={`gr-year-btn${activeYear === y ? " active" : ""}`}
                onClick={() => setActiveYear(y)}
                aria-pressed={activeYear === y}
              >{y}</button>
            ))}
          </nav>
        )}
        {searchMode && (
          <span className="gr-search-count">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <div style={{ marginTop: 48 }}>
        {filtered.length === 0
          ? <p className="gr-no-results">No stories{!searchMode && activeYear ? ` from ${activeYear}` : ""}{query.trim() ? ` matching "${query.trim()}"` : ""}.</p>
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
    </>
  );
}
