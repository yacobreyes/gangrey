"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setPostStage, setPostAssignee, setPostDate } from "../actions";
import type { SanityPost } from "@/lib/sanity";
import type { FlatplanUser } from "@/lib/users";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const CARD_LINE = "#e6e4e0";
const STAGES: { key: string; label: string }[] = [
  { key: "assigned", label: "Assigned" },
  { key: "drafting", label: "Drafting" },
  { key: "editing", label: "Editing" },
  { key: "ready", label: "Ready" },
];
const STATUS_DOT: Record<string, string> = { draft: "#c9a227", scheduled: "#490000", published: "#1a7f37" };
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function initials(name: string) { return name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase(); }

type View = "board" | "day" | "week" | "month";

// Local YYYY-MM-DD for a Date (no UTC shift).
function ymd(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { return addDays(d, -d.getDay()); } // Sunday

export default function EditorialCalendar({ initialUsers = [] }: { initialUsers?: FlatplanUser[] }) {
  const router = useRouter();
  const [view, setView] = useState<View>("board");
  const [posts, setPosts] = useState<SanityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [drag, setDrag] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // A single anchor date drives day/week/month navigation.
  const [cursor, setCursor] = useState(() => new Date());

  useEffect(() => {
    fetch("/api/posts-admin", { cache: "no-store" }).then(r => r.json()).then(d => { if (Array.isArray(d)) setPosts(d); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const users = useMemo(() => initialUsers.filter(u => u.active !== false), [initialUsers]);
  const userByName = useMemo(() => {
    const m: Record<string, FlatplanUser> = {};
    for (const u of users) { const n = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email; m[n] = u; }
    return m;
  }, [users]);

  const drafts = useMemo(() => posts.filter(p => (p.status ?? "draft") === "draft"), [posts]);
  const byStage = useMemo(() => {
    const m: Record<string, SanityPost[]> = { assigned: [], drafting: [], editing: [], ready: [] };
    for (const p of drafts) (m[p.stage && m[p.stage] ? p.stage : "drafting"]).push(p);
    return m;
  }, [drafts]);

  function moveTo(id: string, stage: string) {
    setPosts(prev => prev.map(p => p._id === id ? { ...p, stage } : p));
    setPostStage(id, stage).catch(() => {});
  }
  function assign(id: string, name: string | null) {
    setPosts(prev => prev.map(p => p._id === id ? { ...p, assignee: name ?? undefined } : p));
    setPostAssignee(id, name).catch(() => {});
  }
  function reschedule(id: string, date: string) {
    setPosts(prev => prev.map(p => p._id === id ? { ...p, date } : p));
    setPostDate(id, date).catch(() => {});
  }
  // A compact chip for a piece on a day/week/month cell (drag to reschedule).
  const chip = (p: SanityPost) => (
    <div key={p._id} draggable onDragStart={() => setDrag(p._id)} onDragEnd={() => { setDrag(null); setDragOver(null); }}
      onClick={() => router.push(`/admin/imago/posts/${p.slug}`)} title={p.headline}
      style={{ display: "flex", alignItems: "center", gap: 5, cursor: "grab", padding: "3px 5px", borderRadius: 5, marginBottom: 3, background: drag === p._id ? "#eef0f2" : "#f7f7f7", border: `1px solid ${CARD_LINE}` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_DOT[p.status ?? "published"] ?? TEXT_MUTED, flexShrink: 0 }} />
      <span style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 600, color: TEXT_DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.headline || "Untitled"}</span>
    </div>
  );

  const avatar = (name?: string, size = 22) => {
    if (!name) return <span style={{ width: size, height: size, borderRadius: "50%", border: `1px dashed ${BORDER}`, display: "inline-flex", flexShrink: 0 }} />;
    const u = userByName[name];
    return <span title={name} style={{ width: size, height: size, borderRadius: "50%", background: CRIMSON, color: "white", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: size * 0.4, fontWeight: 800, flexShrink: 0, overflow: "hidden" }}>{u?.photoUrl ? <img src={u.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(name)}</span>;
  };

  const card = (p: SanityPost) => (
    <div key={p._id} draggable onDragStart={() => setDrag(p._id)} onDragEnd={() => { setDrag(null); setDragOver(null); }}
      onClick={() => router.push(`/admin/imago/posts/${p.slug}`)}
      style={{ background: "white", border: `1px solid ${CARD_LINE}`, borderRadius: 10, padding: "0.7rem 0.8rem", marginBottom: 8, cursor: "grab", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", opacity: drag === p._id ? 0.5 : 1 }}>
      <div style={{ fontFamily: "var(--font-headline)", fontSize: "0.98rem", fontWeight: 700, color: TEXT_DARK, lineHeight: 1.25, marginBottom: 4 }}>{p.headline || "Untitled"}</div>
      <div style={{ fontFamily: FONT, fontSize: "0.72rem", color: TEXT_MUTED, marginBottom: 8 }}>{[p.section, p.date].filter(Boolean).join(" · ")}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }} onClick={e => e.stopPropagation()}>
        <select value={p.assignee ?? ""} onChange={e => assign(p._id, e.target.value || null)}
          style={{ fontFamily: FONT, fontSize: "0.72rem", color: p.assignee ? TEXT_DARK : TEXT_MUTED, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0.2rem 0.35rem", background: "white", maxWidth: 120 }}>
          <option value="">Unassigned</option>
          {/* Include the current assignee even if they're not in the users list,
              so the dropdown never silently disagrees with the avatar. */}
          {Array.from(new Set([...(p.assignee ? [p.assignee] : []), ...Object.keys(userByName)])).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        {avatar(p.assignee)}
      </div>
    </div>
  );

  // ---- Calendar month grid ----
  const monthGrid = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    return cells;
  }, [cursor]);
  const postsByDay = useMemo(() => {
    const m: Record<string, SanityPost[]> = {};
    for (const p of posts) { const d = (p.date ?? "").slice(0, 10); if (d) (m[d] = m[d] ?? []).push(p); }
    return m;
  }, [posts]);
  const todayStr = ymd(new Date());
  const weekDays = useMemo(() => { const s = startOfWeek(cursor); return Array.from({ length: 7 }, (_, i) => ymd(addDays(s, i))); }, [cursor]);

  // A droppable day cell/column that reschedules a dragged piece onto its date.
  const dayDrop = (date: string) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(date); },
    onDragLeave: () => setDragOver(o => o === date ? null : o),
    onDrop: () => { if (drag) reschedule(drag, date); setDrag(null); setDragOver(null); },
  });

  // Header title + prev/next step per view.
  const step = (dir: number) => setCursor(c => view === "month" ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, dir * (view === "week" ? 7 : 1)));
  const headerTitle = view === "month" ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
    : view === "week" ? `Week of ${new Date(weekDays[0] + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : new Date(ymd(cursor) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const navHeader = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.9rem 1.1rem", borderBottom: `1px solid ${BORDER}` }}>
      <button onClick={() => step(-1)} style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED, display: "flex", padding: 4 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg></button>
      <span style={{ fontFamily: "var(--font-headline)", fontSize: "1.15rem", fontWeight: 800, color: TEXT_DARK }}>{headerTitle}</span>
      <button onClick={() => step(1)} style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED, display: "flex", padding: 4 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg></button>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-headline)", fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em", color: TEXT_DARK, margin: 0 }}>Calendar</h1>
          <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, margin: "0.35rem 0 0" }}>Assignments, review stages, and what&apos;s running when.</p>
        </div>
        <div style={{ display: "flex", gap: 4, background: "#eef0f2", borderRadius: 8, padding: 3 }}>
          {(["board", "day", "week", "month"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ border: "none", borderRadius: 6, padding: "0.35rem 0.9rem", fontFamily: FONT, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", textTransform: "capitalize", background: view === v ? "white" : "transparent", color: view === v ? CRIMSON : TEXT_MUTED, boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>{v}</button>
          ))}
        </div>
      </div>

      {loading ? <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>Loading…</p> : view === "board" ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: "0.75rem", alignItems: "start" }}>
          {STAGES.map(st => (
            <div key={st.key}
              onDragOver={e => { e.preventDefault(); setDragOver(st.key); }} onDragLeave={() => setDragOver(o => o === st.key ? null : o)}
              onDrop={() => { if (drag) moveTo(drag, st.key); setDrag(null); setDragOver(null); }}
              style={{ background: dragOver === st.key ? "#f0f2f4" : "#f5f8fa", border: `1px solid ${dragOver === st.key ? CRIMSON : BORDER}`, borderRadius: 12, padding: "0.7rem", minHeight: 120, transition: "background .1s, border-color .1s" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem", padding: "0 0.2rem" }}>
                <span style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: TEXT_MUTED }}>{st.label}</span>
                <span style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 700, color: BORDER }}>{byStage[st.key].length}</span>
              </div>
              {byStage[st.key].map(card)}
            </div>
          ))}
        </div>
      ) : view === "day" ? (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          {navHeader}
          <div {...dayDrop(ymd(cursor))} style={{ padding: "1rem 1.1rem", minHeight: 200, background: dragOver === ymd(cursor) ? "#f0f2f4" : "white" }}>
            {(postsByDay[ymd(cursor)] ?? []).length === 0
              ? <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, margin: 0 }}>Nothing scheduled for this day. Drag a piece here to place it.</p>
              : (postsByDay[ymd(cursor)] ?? []).map(chip)}
          </div>
        </div>
      ) : view === "week" ? (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          {navHeader}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {weekDays.map((day, i) => {
              const d = new Date(day + "T12:00:00");
              return (
                <div key={day} {...dayDrop(day)} style={{ minHeight: 260, borderRight: i !== 6 ? "1px solid #eee" : "none", padding: "0.4rem", background: dragOver === day ? "#f0f2f4" : day === todayStr ? "#fffdf7" : "white" }}>
                  <div style={{ textAlign: "center", marginBottom: 6 }}>
                    <div style={{ fontFamily: FONT, fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TEXT_MUTED }}>{DOW[i]}</div>
                    <div style={{ fontFamily: FONT, fontSize: "1rem", fontWeight: day === todayStr ? 800 : 600, color: day === todayStr ? CRIMSON : TEXT_DARK }}>{d.getDate()}</div>
                  </div>
                  {(postsByDay[day] ?? []).map(chip)}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          {navHeader}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {DOW.map(d => <div key={d} style={{ fontFamily: FONT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TEXT_MUTED, textAlign: "center", padding: "0.5rem 0", borderBottom: `1px solid ${BORDER}` }}>{d}</div>)}
            {monthGrid.map((day, i) => (
              <div key={i} {...(day ? dayDrop(day) : {})} style={{ minHeight: 92, borderRight: (i % 7 !== 6) ? `1px solid #eee` : "none", borderBottom: `1px solid #eee`, padding: "0.35rem", background: day && dragOver === day ? "#f0f2f4" : day === todayStr ? "#fffdf7" : "white" }}>
                {day && <>
                  <div style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: day === todayStr ? 800 : 500, color: day === todayStr ? CRIMSON : TEXT_MUTED, marginBottom: 3 }}>{Number(day.slice(8))}</div>
                  {(postsByDay[day] ?? []).slice(0, 4).map(chip)}
                  {(postsByDay[day] ?? []).length > 4 && <div style={{ fontFamily: FONT, fontSize: "0.66rem", color: TEXT_MUTED }}>+{(postsByDay[day] ?? []).length - 4} more</div>}
                </>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
