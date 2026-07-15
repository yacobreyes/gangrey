"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getCalendarItems, createStoryOnDate, rescheduleCalendarItem, type CalItem } from "../actions";
import type { FlatplanUser } from "@/lib/users";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const CARD_LINE = "#e6e4e0";
// Status dots follow the Imago convention: scheduled = gold, published = green,
// draft = neutral gray.
const STATUS_DOT: Record<string, string> = { draft: "#c2c0bd", scheduled: "#c9a227", published: "#1a7f37", sent: "#1a7f37" };
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

type View = "day" | "week" | "month";

// Local YYYY-MM-DD for a Date (no UTC shift).
function ymd(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { return addDays(d, -d.getDay()); } // Sunday
// Sent/published items are history — they shouldn't be dragged to a new day.
function draggable(it: CalItem): boolean { return it.status !== "published" && it.status !== "sent"; }

export default function EditorialCalendar({ initialUsers = [] }: { initialUsers?: FlatplanUser[] }) {
  void initialUsers;
  const router = useRouter();
  const [view, setView] = useState<View>("week");
  const [items, setItems] = useState<CalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drag, setDrag] = useState<CalItem | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // A single anchor date drives day/week/month navigation.
  const [cursor, setCursor] = useState(() => new Date());

  useEffect(() => {
    getCalendarItems().then(setItems).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function reschedule(it: CalItem, date: string) {
    setItems(prev => prev.map(p => p.id === it.id ? { ...p, date } : p));
    rescheduleCalendarItem(it.kind, it.id, date).catch(() => {});
  }

  // Create a blank story on a given day and jump into the editor to fill it in.
  async function addStory(date: string) {
    if (creating) return;
    setCreating(true);
    try { const { slug } = await createStoryOnDate(date); router.push(`/admin/imago/posts/${slug}`); }
    finally { setCreating(false); }
  }

  const openItem = (it: CalItem) => {
    if (it.kind === "story") router.push(`/admin/imago/posts/${it.slug}`);
    else router.push(`/admin/imago/newsletters/${it.id}`);
  };

  // A compact chip for an item on a day/week/month cell (drag to reschedule).
  const chip = (it: CalItem) => (
    <div key={it.id} draggable={draggable(it)}
      onDragStart={() => draggable(it) && setDrag(it)} onDragEnd={() => { setDrag(null); setDragOver(null); }}
      onClick={() => openItem(it)} title={it.title}
      style={{ display: "flex", alignItems: "center", gap: 5, cursor: draggable(it) ? "grab" : "pointer", padding: "3px 5px", borderRadius: 5, marginBottom: 3, background: drag?.id === it.id ? "#eef0f2" : it.kind === "newsletter" ? "#f9f1f1" : "#f7f7f7", border: `1px solid ${it.kind === "newsletter" ? "#ecdcdc" : CARD_LINE}` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_DOT[it.status] ?? TEXT_MUTED, flexShrink: 0 }} />
      {it.kind === "newsletter" && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={CRIMSON} strokeWidth="2.4" style={{ flexShrink: 0 }}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>
      )}
      <span style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 600, color: TEXT_DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title || "Untitled"}</span>
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
  const itemsByDay = useMemo(() => {
    const m: Record<string, CalItem[]> = {};
    for (const it of items) { const d = (it.date ?? "").slice(0, 10); if (d) (m[d] = m[d] ?? []).push(it); }
    return m;
  }, [items]);
  const todayStr = ymd(new Date());
  const weekDays = useMemo(() => { const s = startOfWeek(cursor); return Array.from({ length: 7 }, (_, i) => ymd(addDays(s, i))); }, [cursor]);

  // A droppable day cell/column that reschedules a dragged item onto its date.
  const dayDrop = (date: string) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(date); },
    onDragLeave: () => setDragOver(o => o === date ? null : o),
    onDrop: () => { if (drag) reschedule(drag, date); setDrag(null); setDragOver(null); },
  });

  // A small "+" that creates a story on this day (hover-revealed on cells).
  const addBtn = (date: string, size = 18) => (
    <button onClick={e => { e.stopPropagation(); addStory(date); }} title="Add a story on this day"
      style={{ width: size, height: size, borderRadius: 5, border: `1px solid ${BORDER}`, background: "white", color: TEXT_MUTED, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, fontSize: size * 0.72, fontWeight: 600 }}>+</button>
  );

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
          <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, margin: "0.35rem 0 0" }}>Stories and newsletters, sorted by publication date.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <button onClick={() => addStory(ymd(cursor))} disabled={creating}
            style={{ border: "none", borderRadius: 8, padding: "0.45rem 0.85rem", fontFamily: FONT, fontSize: "0.8rem", fontWeight: 700, cursor: creating ? "default" : "pointer", background: CRIMSON, color: "white", opacity: creating ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: "1rem", lineHeight: 1 }}>+</span> New story
          </button>
          <div style={{ display: "flex", gap: 4, background: "#eef0f2", borderRadius: 8, padding: 3 }}>
            {(["day", "week", "month"] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{ border: "none", borderRadius: 6, padding: "0.35rem 0.9rem", fontFamily: FONT, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", textTransform: "capitalize", background: view === v ? "white" : "transparent", color: view === v ? CRIMSON : TEXT_MUTED, boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>Loading…</p> : view === "day" ? (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          {navHeader}
          <div {...dayDrop(ymd(cursor))} style={{ padding: "1rem 1.1rem", minHeight: 200, background: dragOver === ymd(cursor) ? "#f0f2f4" : "white" }}>
            {(itemsByDay[ymd(cursor)] ?? []).map(chip)}
            <button onClick={() => addStory(ymd(cursor))} disabled={creating}
              style={{ marginTop: 6, background: "none", border: `1px dashed ${BORDER}`, borderRadius: 6, padding: "0.4rem 0.6rem", fontFamily: FONT, fontSize: "0.78rem", fontWeight: 600, color: TEXT_MUTED, cursor: "pointer", width: "100%", textAlign: "left" }}>+ Add a story</button>
          </div>
        </div>
      ) : view === "week" ? (
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          {navHeader}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {weekDays.map((day, i) => {
              const d = new Date(day + "T12:00:00");
              return (
                <div key={day} {...dayDrop(day)} className="cal-cell" style={{ minHeight: 260, borderRight: i !== 6 ? "1px solid #eee" : "none", padding: "0.4rem", background: dragOver === day ? "#f0f2f4" : day === todayStr ? "#fffdf7" : "white" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, padding: "0 2px" }}>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontFamily: FONT, fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TEXT_MUTED }}>{DOW[i]}</div>
                      <div style={{ fontFamily: FONT, fontSize: "1rem", fontWeight: day === todayStr ? 800 : 600, color: day === todayStr ? CRIMSON : TEXT_DARK }}>{d.getDate()}</div>
                    </div>
                    <span className="cal-add">{addBtn(day)}</span>
                  </div>
                  {(itemsByDay[day] ?? []).map(chip)}
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
              <div key={i} {...(day ? dayDrop(day) : {})} className={day ? "cal-cell" : undefined} style={{ minHeight: 92, borderRight: (i % 7 !== 6) ? `1px solid #eee` : "none", borderBottom: `1px solid #eee`, padding: "0.35rem", background: day && dragOver === day ? "#f0f2f4" : day === todayStr ? "#fffdf7" : "white" }}>
                {day && <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                    <div style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: day === todayStr ? 800 : 500, color: day === todayStr ? CRIMSON : TEXT_MUTED }}>{Number(day.slice(8))}</div>
                    <span className="cal-add">{addBtn(day, 16)}</span>
                  </div>
                  {(itemsByDay[day] ?? []).slice(0, 4).map(chip)}
                  {(itemsByDay[day] ?? []).length > 4 && <div style={{ fontFamily: FONT, fontSize: "0.66rem", color: TEXT_MUTED }}>+{(itemsByDay[day] ?? []).length - 4} more</div>}
                </>}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Reveal each cell's "+" only on hover so the grid stays clean. */}
      <style>{`.cal-add{opacity:0;transition:opacity .1s}.cal-cell:hover .cal-add{opacity:1}`}</style>
    </div>
  );
}
