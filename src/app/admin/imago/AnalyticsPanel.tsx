"use client";

import { useEffect, useState, useCallback } from "react";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

type Bd = { key: string; views: number };
type Top = { slug: string; title: string; section: string; byline: string; views: number; visitors: number; avgEngagedMs: number };
type Data = {
  range: string;
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

function todayStr(): string { return new Date().toISOString().slice(0, 10); }
function shiftDate(d: string, days: number): string {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
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
function delta(d: number) {
  const up = d >= 0;
  return <span style={{ fontSize: "0.72rem", fontWeight: 700, color: up ? "#1a7f37" : "#b3261e" }}>{up ? "▲" : "▼"} {Math.abs(d)}%</span>;
}

export default function AnalyticsPanel() {
  const [range, setRange] = useState("7d");
  // A selected calendar day takes priority over `range` when set — lets you
  // jump to "yesterday" or any specific date, like Parse.ly's day picker.
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((r: string, d: string | null, quiet = false) => {
    if (!quiet) setLoading(true);
    const qs = d ? `date=${d}` : `range=${r}`;
    fetch(`/api/analytics?${qs}`).then(res => res.json()).then(res => { if (!res.error) setData(res); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(range, date); }, [range, date, load]);
  // Live-refresh the realtime numbers every 20s without a full spinner. Only
  // meaningful when viewing today/rolling ranges — still harmless on a past day.
  useEffect(() => { const t = setInterval(() => load(range, date, true), 20_000); return () => clearInterval(t); }, [range, date, load]);

  const today = todayStr();
  const yesterday = shiftDate(today, -1);

  const card: React.CSSProperties = { background: "white", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "1.1rem 1.25rem" };
  const h2: React.CSSProperties = { fontFamily: FONT, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: TEXT_MUTED, margin: "0 0 0.9rem" };

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontFamily: FONT, fontSize: "1.4rem", fontWeight: 800, color: TEXT_DARK, margin: 0 }}>Analytics</h1>
          <p style={{ fontFamily: FONT, fontSize: "0.82rem", color: TEXT_MUTED, margin: "0.25rem 0 0" }}>Your traffic, engagement, and what&apos;s trending — all self-hosted.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          {/* Day picker: Today / Yesterday / any date, with prev-next arrows —
              answers "how did I do on [day]" the way Parse.ly's date nav does. */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#f4f4f5", borderRadius: 8, padding: 3 }}>
            <button onClick={() => setDate(today)} style={{
              border: "none", borderRadius: 6, padding: "0.35rem 0.7rem", fontFamily: FONT, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
              background: date === today ? "white" : "transparent", color: date === today ? CRIMSON : TEXT_MUTED, boxShadow: date === today ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            }}>Today</button>
            <button onClick={() => setDate(yesterday)} style={{
              border: "none", borderRadius: 6, padding: "0.35rem 0.7rem", fontFamily: FONT, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
              background: date === yesterday ? "white" : "transparent", color: date === yesterday ? CRIMSON : TEXT_MUTED, boxShadow: date === yesterday ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            }}>Yesterday</button>
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
          <div style={{ display: "flex", gap: 4, background: "#f4f4f5", borderRadius: 8, padding: 3 }}>
            {RANGES.map(([k, label]) => (
              <button key={k} onClick={() => { setDate(null); setRange(k); }} style={{
                border: "none", borderRadius: 6, padding: "0.35rem 0.7rem", fontFamily: FONT, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
                background: !date && range === k ? "white" : "transparent", color: !date && range === k ? CRIMSON : TEXT_MUTED, boxShadow: !date && range === k ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>Loading…</p>
      ) : !data ? (
        <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>No analytics yet — data appears as readers visit.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Realtime + KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
            <div style={{ ...card, borderColor: "#c8e6d0", background: "#f2fbf5" }}>
              <div style={h2}>● Active now</div>
              <div style={{ fontFamily: FONT, fontSize: "2rem", fontWeight: 800, color: "#1a7f37", lineHeight: 1 }}>{fmtN(data.realtime.active)}</div>
              <div style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, marginTop: 4 }}>readers in the last 5 min</div>
            </div>
            <Kpi title="Views" value={fmtN(data.overview.views)} d={data.overview.viewsDelta} card={card} h2={h2} compareLabel={date ? "vs. day before" : "vs. previous period"} />
            <Kpi title="Visitors" value={fmtN(data.overview.visitors)} d={data.overview.visitorsDelta} card={card} h2={h2} compareLabel={date ? "vs. day before" : "vs. previous period"} />
            <Kpi title="Avg. engaged time" value={fmtDur(data.overview.avgEngagedMs)} d={data.overview.engagedDelta} card={card} h2={h2} compareLabel={date ? "vs. day before" : "vs. previous period"} />
          </div>

          {/* Time series */}
          <div style={card}>
            <div style={{ ...h2, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span>Views {date ? "by hour" : "over time"}</span>
              {date && <span style={{ color: TEXT_DARK, fontWeight: 700, letterSpacing: 0, textTransform: "none", fontSize: "0.78rem" }}>{fmtDateLabel(date)}</span>}
            </div>
            <Series data={data} prevLabel={date ? "Day before" : range === "7d" ? "Previous week" : range === "30d" ? "Previous month" : "Previous 90 days"} />
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
                    <th style={{ padding: "0 0 0.5rem" }}>Story</th>
                    <th style={{ padding: "0 0.5rem 0.5rem", textAlign: "right" }}>Views</th>
                    <th style={{ padding: "0 0.5rem 0.5rem", textAlign: "right" }}>Visitors</th>
                    <th style={{ padding: "0 0 0.5rem", textAlign: "right" }}>Avg. time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.length === 0 ? <tr><td colSpan={4}><Empty /></td></tr> : data.top.map(t => (
                    <tr key={t.slug} style={{ borderTop: `1px solid ${BORDER}` }}>
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
function Series({ data, prevLabel }: { data: Data; prevLabel: string }) {
  const { series: values, prevSeries, since, until, buckets } = data;
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values, ...prevSeries);
  const bucketMs = (until - since) / buckets;
  const hourly = buckets === 24 && bucketMs <= 3600_000 + 1000;

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
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.6rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: FONT, fontSize: "0.72rem", color: TEXT_MUTED }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: CRIMSON, display: "inline-block" }} /> This period
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: FONT, fontSize: "0.72rem", color: TEXT_MUTED }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "#e3ded9", display: "inline-block" }} /> {prevLabel}
        </span>
      </div>
      <div style={{ position: "relative" }}>
        {hover !== null && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: `${((hover + 0.5) / buckets) * 100}%`, transform: "translateX(-50%)",
            background: "#2a2622", color: "white", borderRadius: 6, padding: "0.4rem 0.6rem", fontFamily: FONT, fontSize: "0.72rem",
            whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5, boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{bucketLabel(hover)}{hourly ? "" : `, ${new Date(since + hover * bucketMs).getFullYear()}`}</div>
            <div><span style={{ color: "#f0a8a8" }}>●</span> {fmtN(values[hover] ?? 0)} views</div>
            <div style={{ color: "#a8a29b" }}><span style={{ color: "#a8a29b" }}>●</span> {fmtN(prevSeries[hover] ?? 0)} {prevLabel.toLowerCase()}</div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: buckets > 30 ? 1 : 3, height: 130 }}>
          {values.map((v, i) => (
            <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", gap: 1, cursor: "pointer", position: "relative" }}>
              {hover === i && <div style={{ position: "absolute", inset: "0 -1px", background: "rgba(73,0,0,0.05)" }} />}
              <div style={{ flex: 1, height: `${((prevSeries[i] ?? 0) / max) * 100}%`, minHeight: (prevSeries[i] ?? 0) > 0 ? 2 : 0, background: "#e3ded9", borderRadius: "2px 2px 0 0" }} />
              <div style={{ flex: 1, height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0, background: CRIMSON, borderRadius: "2px 2px 0 0", opacity: hover === null || hover === i ? 0.9 : 0.45, transition: "opacity .1s" }} />
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
