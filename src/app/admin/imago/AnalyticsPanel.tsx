"use client";

import { useEffect, useState, useCallback } from "react";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

type Bd = { key: string; views: number };
type Top = { slug: string; title: string; section: string; byline: string; views: number; visitors: number; avgEngagedMs: number };
type Data = {
  range: string;
  author?: string | null;
  authorStoryCount?: number;
  since: number; until: number; buckets: number;
  overview: { views: number; visitors: number; engagedMs: number; avgEngagedMs: number; viewsDelta: number; visitorsDelta: number; engagedDelta: number };
  series: number[];
  prevSeries: number[];
  top: Top[];
  sources: Bd[]; sections: Bd[]; authors: Bd[]; devices: Bd[];
  trending: { slug: string; title: string; recent: number; score: number }[];
  realtime: { active: number; reading: { slug: string; title: string; views: number }[] };
};

const RANGES: [string, string][] = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]];

// Format a Date as YYYY-MM-DD in LOCAL time (toISOString uses UTC and can land
// on the wrong calendar day near midnight).
function localYmd(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function todayStr(): string { return localYmd(new Date()); }
function shiftDate(d: string, days: number): string {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + days);
  return localYmd(dt);
}
function fmtDateLabel(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
function fmtN(n: number): string { return n.toLocaleString("en-US"); }
// Abbreviated ("24.3k", "1.2m") for the compact mobile KPI cards.
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
function delta(d: number) {
  const up = d >= 0;
  // Brand-only palette: EARTH for up, CRIMSON for down (no green/red).
  return <span style={{ fontSize: "0.72rem", fontWeight: 700, color: up ? TEXT_MUTED : CRIMSON }}>{up ? "▲" : "▼"} {Math.abs(d)}%</span>;
}

export default function AnalyticsPanel() {
  const [range, setRange] = useState("7d");
  // A selected calendar day takes priority over `range` when set — lets you
  // jump to "yesterday" or any specific date, like Parse.ly's day picker.
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  // Author filter: narrows every number on the panel to one writer's stories.
  const [author, setAuthor] = useState<string | null>(null);
  const [authorMenuOpen, setAuthorMenuOpen] = useState(false);
  const [authorQuery, setAuthorQuery] = useState("");
  // The picker's option list — captured from responses so it stays complete
  // (the API's `authors` breakdown is always unfiltered).
  const [authorOptions, setAuthorOptions] = useState<Bd[]>([]);
  // Compact 2x2 KPI layout + shorter chart on phones (the mobile prototype).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 700);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const load = useCallback((r: string, d: string | null, a: string | null, quiet = false) => {
    if (!quiet) setLoading(true);
    // Send the viewer's tz offset so the server computes day windows in local time.
    const tz = new Date().getTimezoneOffset();
    const qs = (d ? `date=${d}` : `range=${r}`) + `&tz=${tz}` + (a ? `&author=${encodeURIComponent(a)}` : "");
    fetch(`/api/analytics?${qs}`).then(res => res.json()).then(res => {
      if (!res.error) {
        setData(res);
        if (Array.isArray(res.authors)) setAuthorOptions(res.authors);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(range, date, author); }, [range, date, author, load]);
  // Live-refresh the realtime numbers every 20s without a full spinner. Only
  // meaningful when viewing today/rolling ranges — still harmless on a past day.
  useEffect(() => { const t = setInterval(() => load(range, date, author, true), 20_000); return () => clearInterval(t); }, [range, date, author, load]);

  const today = todayStr();
  const yesterday = shiftDate(today, -1);

  const card: React.CSSProperties = { background: "white", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "1.1rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
  const h2: React.CSSProperties = { fontFamily: FONT, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: TEXT_MUTED, margin: "0 0 0.9rem" };

  return (
    <div>
      {/* The mobile header already titles the panel "Analytics" — repeating an
          h1 under it wastes a screen line, so the title row is desktop-only. */}
      <style>{`@media (max-width: 700px) {
        .an-title { display: none; }
        /* Clamp the dropdown so it never runs off-screen; it stays
           right-anchored under the (right-aligned) pill. */
        .an-author-menu { width: min(250px, calc(100vw - 2rem)) !important; }
        /* Stack the controls: the author pill stays a small button, aligned
           right on its own row; the range chips fill the next row. The
           advanced day-drilldown is hidden on mobile (tap a chart bar to drill
           into a day; a range chip resets). */
        .an-controls { flex-direction: column; align-items: stretch !important; width: 100%; }
        .an-author-wrap { align-self: flex-end; }
        .an-ranges { width: 100%; }
        .an-ranges > button { flex: 1; }
        .an-daypicker { display: none !important; }
      }`}</style>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div className="an-title">
          <h1 style={{ fontFamily: "var(--font-headline)", fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em", color: TEXT_DARK, margin: 0 }}>Analytics</h1>
          <p style={{ fontFamily: FONT, fontSize: "0.82rem", color: TEXT_MUTED, margin: "0.35rem 0 0" }}>Your traffic and engagement. All self-hosted.</p>
        </div>
        <div className="an-controls" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          {/* Author filter — narrows the whole panel to one writer. */}
          <div className="an-author-wrap" style={{ position: "relative" }}>
            <button onClick={() => { setAuthorMenuOpen(v => !v); setAuthorQuery(""); }}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "white", border: `1px solid ${author ? CRIMSON : BORDER}`, borderRadius: 9, padding: "0.42rem 0.7rem 0.42rem 0.8rem", fontFamily: FONT, fontSize: "0.82rem", fontWeight: 600, color: author ? CRIMSON : TEXT_MUTED, cursor: "pointer", whiteSpace: "nowrap" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {author ?? "All authors"}
              {author ? (
                <span onClick={e => { e.stopPropagation(); setAuthor(null); setAuthorMenuOpen(false); }}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: "50%", color: CRIMSON, fontSize: "1rem", lineHeight: 1, marginLeft: "0.1rem" }}>×</span>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              )}
            </button>
            {authorMenuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setAuthorMenuOpen(false)} />
                <div className="an-author-menu" style={{ position: "absolute", top: "calc(100% + 0.4rem)", right: 0, zIndex: 80, background: "white", border: `1px solid ${BORDER}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.14)", width: 250, overflow: "hidden" }}>
                  <div style={{ padding: "0.6rem 0.7rem", borderBottom: "1px solid #eee", position: "relative" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={BORDER} strokeWidth="2" strokeLinecap="round" style={{ position: "absolute", left: "1.15rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input autoFocus value={authorQuery} onChange={e => setAuthorQuery(e.target.value)} placeholder="Search authors"
                      style={{ width: "100%", boxSizing: "border-box", fontFamily: FONT, fontSize: "0.85rem", padding: "0.4rem 0.5rem 0.4rem 1.7rem", border: `1px solid ${BORDER}`, borderRadius: 6, outline: "none", color: TEXT_DARK }} />
                  </div>
                  <div style={{ maxHeight: 230, overflowY: "auto", padding: "0.3rem" }}>
                    {(() => {
                      const q = authorQuery.trim().toLowerCase();
                      const opts = authorOptions.filter(a => a.key !== "—" && (!q || a.key.toLowerCase().includes(q)));
                      if (!opts.length) return <div style={{ padding: "0.7rem 0.6rem", fontFamily: FONT, fontSize: "0.82rem", color: BORDER }}>No authors match.</div>;
                      return opts.map(a => (
                        <button key={a.key} onClick={() => { setAuthor(a.key); setAuthorMenuOpen(false); }}
                          style={{ display: "flex", alignItems: "center", gap: "0.6rem", width: "100%", background: "none", border: "none", borderRadius: 6, padding: "0.5rem 0.6rem", cursor: "pointer", textAlign: "left" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f7f7f7")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                          <span style={{ width: 26, height: 26, borderRadius: "50%", background: CRIMSON, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: "0.66rem", fontWeight: 800, flexShrink: 0 }}>
                            {a.key.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                          </span>
                          <span style={{ flex: 1, minWidth: 0, fontFamily: FONT, fontSize: "0.86rem", color: TEXT_DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.key}</span>
                          <span style={{ fontFamily: FONT, fontSize: "0.74rem", color: BORDER, flexShrink: 0 }}>{fmtN(a.views)}</span>
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="an-ranges" style={{ display: "flex", gap: 4, background: "#f4f4f5", borderRadius: 8, padding: 3 }}>
            {RANGES.map(([k, label]) => (
              <button key={k} onClick={() => { setDate(null); setRange(k); }} style={{
                border: "none", borderRadius: 6, padding: "0.35rem 0.7rem", fontFamily: FONT, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
                background: !date && range === k ? "white" : "transparent", color: !date && range === k ? CRIMSON : TEXT_MUTED, boxShadow: !date && range === k ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              }}>{label}</button>
            ))}
          </div>
          {/* Day drill-down (Today / Yesterday / any date) — sits inline in the
              header controls so nothing floats on its own row; hidden on mobile
              (tap a chart bar to drill into a day; a range chip resets). */}
          <div className="an-daypicker" style={{ display: "flex", alignItems: "center", gap: 4, background: "#f4f4f5", borderRadius: 8, padding: 3 }}>
            <button onClick={() => setDate(today)} style={{
              border: "none", borderRadius: 6, padding: "0.35rem 0.7rem", fontFamily: FONT, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
              background: date === today ? "white" : "transparent", color: date === today ? CRIMSON : TEXT_MUTED, boxShadow: date === today ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            }}>Today</button>
            <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 2 }}>
              <button aria-label="Previous day" onClick={() => setDate(shiftDate(date ?? today, -1))} style={{ border: "none", background: "none", cursor: "pointer", color: TEXT_MUTED, padding: "0.3rem 0.35rem", display: "flex" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <input type="date" value={date ?? ""} max={today} onChange={e => e.target.value && setDate(e.target.value)}
                style={{ border: "none", background: date ? "white" : "transparent", borderRadius: 6, boxShadow: date && date !== today && date !== yesterday ? "0 1px 3px rgba(0,0,0,0.12)" : "none", padding: "0.32rem 0.4rem", fontFamily: FONT, fontSize: "0.76rem", color: date && date !== today && date !== yesterday ? CRIMSON : TEXT_MUTED, cursor: "pointer" }} />
              <button aria-label="Next day" disabled={date === today} onClick={() => setDate(shiftDate(date ?? today, 1))} style={{ border: "none", background: "none", cursor: date === today ? "default" : "pointer", color: date === today ? "#d0cec9" : TEXT_MUTED, padding: "0.3rem 0.35rem", display: "flex" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      {author && (
        <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, margin: "-0.5rem 0 1rem" }}>
          Showing analytics for <span style={{ fontWeight: 700, color: CRIMSON }}>{author}</span>
          {data?.authorStoryCount ? <> &middot; {data.authorStoryCount.toLocaleString()} {data.authorStoryCount === 1 ? "story" : "stories"}</> : null}
        </p>
      )}
      {loading && !data ? (
        <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>Loading…</p>
      ) : !data ? (
        <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>No analytics yet — data appears as readers visit.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Realtime + KPIs — compact 2x2 on phones (no deltas, abbreviated
              numbers, short labels), full cards with deltas on desktop. */}
          {isMobile ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem" }}>
              <MiniKpi label="Active now" value={fmtN(data.realtime.active)} dot card={card} />
              <MiniKpi label="Views" value={fmtCompact(data.overview.views)} card={card} />
              <MiniKpi label="Visitors" value={fmtCompact(data.overview.visitors)} card={card} />
              <MiniKpi label="Engaged" value={fmtDur(data.overview.avgEngagedMs)} card={card} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
              <div style={card}>
                <div style={{ ...h2, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: CRIMSON, display: "inline-block" }} />Active now</div>
                <div style={{ fontFamily: FONT, fontSize: "2rem", fontWeight: 800, color: CRIMSON, lineHeight: 1 }}>{fmtN(data.realtime.active)}</div>
                <div style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, marginTop: 4 }}>readers in the last 5 min</div>
              </div>
              <Kpi title="Views" value={fmtN(data.overview.views)} d={data.overview.viewsDelta} card={card} h2={h2} compareLabel={date ? "vs. day before" : "vs. previous period"} />
              <Kpi title="Visitors" value={fmtN(data.overview.visitors)} d={data.overview.visitorsDelta} card={card} h2={h2} compareLabel={date ? "vs. day before" : "vs. previous period"} />
              <Kpi title="Avg. engaged time" value={fmtDur(data.overview.avgEngagedMs)} d={data.overview.engagedDelta} card={card} h2={h2} compareLabel={date ? "vs. day before" : "vs. previous period"} />
            </div>
          )}

          {/* Time series */}
          <div style={card}>
            <div style={{ ...h2, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span>Views {date ? "by hour" : "over time"}</span>
              {date && <span style={{ color: TEXT_DARK, fontWeight: 700, letterSpacing: 0, textTransform: "none", fontSize: "0.78rem" }}>{fmtDateLabel(date)}</span>}
            </div>
            <Series data={data} onPickDate={setDate} mobileChart={isMobile} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem" }}>
            {/* Trending */}
            <div style={card}>
              <div style={h2}>🔥 Trending now</div>
              {data.trending.length === 0 ? <Empty /> : data.trending.map((t, i) => (
                <Row key={t.slug} i={i} title={t.title} slug={t.slug} right={`${fmtN(t.recent)} views/3h`} />
              ))}
            </div>
            {/* Reading now */}
            <div style={card}>
              <div style={h2}>Reading right now</div>
              {data.realtime.reading.length === 0 ? <Empty /> : data.realtime.reading.map((r, i) => (
                <Row key={r.slug} i={i} title={r.title} slug={r.slug} right={`${fmtN(r.views)}`} />
              ))}
            </div>
          </div>

          {/* Top content table */}
          <div style={card}>
            <div style={h2}>Top stories</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT }}>
                <thead>
                  <tr style={{ textAlign: "left", color: TEXT_MUTED, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    <th style={{ padding: "0 0 0.5rem" }} aria-hidden="true"></th>
                    <th style={{ padding: "0 0 0.5rem" }}>Story</th>
                    <th style={{ padding: "0 0.5rem 0.5rem", textAlign: "right" }}>Views</th>
                    <th style={{ padding: "0 0.5rem 0.5rem", textAlign: "right" }}>Visitors</th>
                    <th style={{ padding: "0 0 0.5rem", textAlign: "right" }}>Avg. time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.length === 0 ? <tr><td colSpan={5}><Empty /></td></tr> : data.top.map((t, i) => (
                    <tr key={t.slug} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={{ padding: "0.55rem 0.5rem 0.55rem 0", width: 24, verticalAlign: "top" }}>
                        <span style={{ fontFamily: FONT, fontSize: "0.78rem", fontWeight: 800, color: TEXT_MUTED }}>{i + 1}</span>
                      </td>
                      <td style={{ padding: "0.55rem 0.5rem 0.55rem 0", maxWidth: 340 }}>
                        <a href={`/stories/${t.slug}`} target="_blank" rel="noreferrer" style={{ color: TEXT_DARK, fontWeight: 600, fontSize: "0.86rem", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</a>
                        <span style={{ color: TEXT_MUTED, fontSize: "0.7rem" }}>{t.section || "—"}{t.byline ? ` · ${t.byline}` : ""}</span>
                      </td>
                      <td style={{ padding: "0.55rem 0.5rem", textAlign: "right", fontSize: "0.85rem", fontWeight: 600, color: TEXT_DARK }}>{fmtN(t.views)}</td>
                      <td style={{ padding: "0.55rem 0.5rem", textAlign: "right", fontSize: "0.85rem", color: TEXT_MUTED }}>{fmtN(t.visitors)}</td>
                      <td style={{ padding: "0.55rem 0", textAlign: "right", fontSize: "0.85rem", color: TEXT_MUTED }}>{fmtDur(t.avgEngagedMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Breakdowns */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "1rem" }}>
            <BarList title="Traffic sources" rows={data.sources} card={card} h2={h2} />
            <BarList title="Sections" rows={data.sections} card={card} h2={h2} />
            <BarList title="Authors" rows={data.authors} card={card} h2={h2} />
            <BarList title="Devices" rows={data.devices} card={card} h2={h2} />
          </div>
        </div>
      )}
    </div>
  );
}

function MiniKpi({ label, value, dot = false, card }: { label: string; value: string; dot?: boolean; card: React.CSSProperties }) {
  return (
    <div style={{ ...card, padding: "0.9rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT, fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TEXT_MUTED, marginBottom: "0.4rem" }}>
        {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: CRIMSON, display: "inline-block" }} />}{label}
      </div>
      <div style={{ fontFamily: FONT, fontSize: "1.7rem", fontWeight: 800, color: dot ? CRIMSON : TEXT_DARK, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function Kpi({ title, value, d, card, h2, compareLabel }: { title: string; value: string; d: number; card: React.CSSProperties; h2: React.CSSProperties; compareLabel: string }) {
  return (
    <div style={card}>
      <div style={h2}>{title}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <div style={{ fontFamily: FONT, fontSize: "2rem", fontWeight: 800, color: TEXT_DARK, lineHeight: 1 }}>{value}</div>
        {delta(d)}
      </div>
      <div style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, marginTop: 4 }}>{compareLabel}</div>
    </div>
  );
}

// Labeled, hoverable bar chart with a previous-period overlay, so "day-over-
// day / week-over-week / month-over-month" is something you can actually see
// rather than infer from a KPI percentage. Each bucket shows this-period
// (solid crimson) beside the same bucket from the prior period (light grey).
function Series({ data, onPickDate, mobileChart = false }: { data: Data; onPickDate: (d: string) => void; mobileChart?: boolean }) {
  const { series: values, since, until, buckets } = data;
  const [hover, setHover] = useState<number | null>(null);
  // Clicking a bar pins its tooltip open (essential on touch, where there's no
  // hover). On daily charts, clicking also drills the whole panel into that day.
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hover ?? pinned;
  const max = Math.max(1, ...values);
  const bucketMs = (until - since) / buckets;
  const hourly = buckets === 24 && bucketMs <= 3600_000 + 1000;

  function bucketDateStr(i: number): string {
    const t = new Date(since + i * bucketMs);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }

  function bucketLabel(i: number, short = false): string {
    const t = new Date(since + i * bucketMs);
    if (hourly) {
      const h = t.getHours();
      const label = h === 0 ? "12a" : h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`;
      return label;
    }
    return t.toLocaleDateString("en-US", short ? { month: "numeric", day: "numeric" } : { month: "short", day: "numeric" });
  }

  // Thin out x-axis labels so they don't collide — show every Nth tick.
  const labelEvery = buckets <= 8 ? 1 : buckets <= 24 ? 3 : Math.ceil(buckets / 8);

  return (
    <div>
      <div style={{ position: "relative" }}>
        {active !== null && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: `${((active + 0.5) / buckets) * 100}%`, transform: "translateX(-50%)",
            background: "#2a2622", color: "white", borderRadius: 6, padding: "0.4rem 0.6rem", fontFamily: FONT, fontSize: "0.72rem",
            whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5, boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{bucketLabel(active)}{hourly ? "" : `, ${new Date(since + active * bucketMs).getFullYear()}`}</div>
            <div><span style={{ color: "#f0a8a8" }}>●</span> {fmtN(values[active] ?? 0)} page views</div>
            {!hourly && <div style={{ color: "#a8a29b", marginTop: 2 }}>Click to open this day</div>}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: buckets > 30 ? 1 : 3, height: mobileChart ? 90 : 130 }}>
          {values.map((v, i) => (
            <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onClick={() => {
                // Daily bars drill the whole panel into that day; hourly bars
                // pin/unpin the tooltip (there's no hover on touch).
                if (!hourly) onPickDate(bucketDateStr(i));
                else setPinned(p => (p === i ? null : i));
              }}
              style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", gap: 1, cursor: "pointer", position: "relative" }}>
              {active === i && <div style={{ position: "absolute", inset: "0 -1px", background: "rgba(73,0,0,0.05)" }} />}
              <div style={{ flex: 1, height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0, background: CRIMSON, borderRadius: "2px 2px 0 0", opacity: active === null || active === i ? 0.9 : 0.45, transition: "opacity .1s" }} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", marginTop: "0.4rem" }}>
        {values.map((_, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontFamily: FONT, fontSize: "0.65rem", color: TEXT_MUTED }}>
            {i % labelEvery === 0 ? bucketLabel(i, true) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function BarList({ title, rows, card, h2 }: { title: string; rows: Bd[]; card: React.CSSProperties; h2: React.CSSProperties }) {
  const max = Math.max(1, ...rows.map(r => r.views));
  return (
    <div style={card}>
      <div style={h2}>{title}</div>
      {rows.length === 0 ? <Empty /> : rows.map(r => (
        <div key={r.key} style={{ marginBottom: "0.6rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT, fontSize: "0.8rem", marginBottom: 3 }}>
            <span style={{ color: TEXT_DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{r.key}</span>
            <span style={{ color: TEXT_MUTED, fontWeight: 600 }}>{fmtN(r.views)}</span>
          </div>
          <div style={{ height: 5, background: "#f0eef0", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(r.views / max) * 100}%`, background: CRIMSON, opacity: 0.75 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ i, title, slug, right }: { i: number; title: string; slug: string; right: string }) {
  return (
    <a href={`/stories/${slug}`} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", padding: "0.4rem 0", borderTop: i > 0 ? `1px solid ${BORDER}` : "none", textDecoration: "none" }}>
      <span style={{ fontFamily: FONT, fontSize: "0.78rem", fontWeight: 700, color: TEXT_MUTED, width: 16, flexShrink: 0 }}>{i + 1}</span>
      <span style={{ fontFamily: FONT, fontSize: "0.84rem", fontWeight: 600, color: TEXT_DARK, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
      <span style={{ fontFamily: FONT, fontSize: "0.76rem", color: TEXT_MUTED, flexShrink: 0 }}>{right}</span>
    </a>
  );
}

function Empty() {
  return <p style={{ fontFamily: FONT, fontSize: "0.82rem", color: TEXT_MUTED, margin: "0.3rem 0" }}>No data yet.</p>;
}
