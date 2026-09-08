"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Scoop — the Tampa permit reporting desk. Imports the city's daily permit
// data (automated CivicData pull or a manual file upload), diffs it against
// what we've seen, clusters permits into projects and ranks a reporting queue.
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const TEXT_DARK = "#1d1d1f";
const TEXT_MUTED = "#6e6e73";
const BORDER = "#e3e1dd";
const CRIMSON = "#8f0f1b";

type LeadPermit = {
  permitId: string; recordType: string; description: string; status: string;
  appliedDate: string; valuation: number | null; score: number;
  firstSeenAt: string; changedAt: string | null; link: string;
};
type Lead = {
  clusterKey: string; address: string; parcel: string; projectName: string;
  firstSeen: string; lastActivity: string; permitCount: number; topScore: number;
  isNew: boolean; isChanged: boolean; reasons: [number, string][]; permits: LeadPermit[];
};
type ImportRow = {
  id: number; source: string; filename: string; imported_at: string;
  row_count: number; inserted_count: number; changed_count: number; unchanged_count: number; error_count: number;
};
type LeadsResponse = { leads: Lead[]; total: number; bands: { high: number; watch: number }; imports: ImportRow[] };
type ImportResult = {
  alreadyImported?: boolean; rowCount?: number; inserted?: number; changed?: number;
  unchanged?: number; errors?: number; error?: string;
};

const money = (n: number | null) => n == null ? "" : "$" + Math.round(n).toLocaleString("en-US");
const day = (iso: string) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

type FilterKey = "all" | "new" | "changed" | "restaurants" | "development";

export default function ScoopPanel() {
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [minScore, setMinScore] = useState(0);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState<"" | "fetch" | "upload">("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ days: String(days) });
    if (filter === "new") params.set("new", "1");
    if (filter === "changed") params.set("changed", "1");
    if (filter === "restaurants") params.set("restaurants", "1");
    if (filter === "development") params.set("development", "1");
    if (minScore > 0) params.set("minScore", String(minScore));
    try {
      const r = await fetch(`/api/admin/scoop/leads?${params}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch { /* leave the last good queue up */ }
    setLoading(false);
  }, [filter, minScore, days]);

  useEffect(() => { load(); }, [load]);

  function describeImport(s: ImportResult): string {
    if (s.error) return `Import failed: ${s.error}`;
    if (s.alreadyImported) return "Report already imported. No changes made.";
    return `${(s.rowCount ?? 0).toLocaleString()} rows processed: ${s.inserted ?? 0} new, ${s.changed ?? 0} changed, ${s.unchanged ?? 0} unchanged${s.errors ? `, ${s.errors} errors` : ""}.`;
  }

  async function fetchNow() {
    setBusy("fetch"); setNotice("Fetching the latest report from the city feed…");
    try {
      const r = await fetch("/api/admin/scoop/fetch", { method: "POST" });
      setNotice(describeImport(await r.json()));
    } catch (e) { setNotice(`Fetch failed: ${String(e)}`); }
    setBusy(""); load();
  }

  async function upload(file: File) {
    setBusy("upload"); setNotice(`Importing ${file.name}…`);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/admin/scoop/import", { method: "POST", body: fd });
      setNotice(describeImport(await r.json()));
    } catch (e) { setNotice(`Import failed: ${String(e)}`); }
    setBusy(""); load();
  }

  const chips: [FilterKey, string][] = [["all", "All"], ["new", "New"], ["changed", "Changed"], ["restaurants", "Restaurants"], ["development", "Development"]];
  const lastImport = data?.imports?.[0];

  return (
    <div style={{ fontFamily: FONT, maxWidth: 860 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "1rem" }}>
        <div>
          <h1 className="admin-h1">Lead Desk</h1>
          <p className="admin-sub">
            {lastImport
              ? `Last import ${day(lastImport.imported_at)}: ${lastImport.row_count.toLocaleString()} rows, ${lastImport.inserted_count} new, ${lastImport.changed_count} changed.`
              : "No reports imported yet. Fetch the city feed or upload a report file."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={fetchNow} disabled={busy !== ""}
            style={{ fontFamily: FONT, fontSize: "0.85rem", fontWeight: 700, padding: "0.55rem 1rem", borderRadius: 8, border: "none", background: CRIMSON, color: "white", cursor: busy ? "default" : "pointer", opacity: busy === "fetch" ? 0.6 : 1 }}>
            {busy === "fetch" ? "Fetching…" : "Fetch latest report"}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy !== ""}
            style={{ fontFamily: FONT, fontSize: "0.85rem", fontWeight: 700, padding: "0.55rem 1rem", borderRadius: 8, border: `1px solid ${BORDER}`, background: "white", color: TEXT_DARK, cursor: busy ? "default" : "pointer" }}>
            {busy === "upload" ? "Importing…" : "Upload a report"}
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      </div>

      {notice && (
        <p style={{ fontSize: "0.85rem", color: TEXT_DARK, background: "#f4f2ee", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "0.6rem 0.9rem", margin: "0 0 1rem" }}>{notice}</p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: "1rem" }}>
        {chips.map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)}
            style={{ fontFamily: FONT, fontSize: "0.8rem", fontWeight: 600, padding: "0.35rem 0.8rem", borderRadius: 16, cursor: "pointer", border: `1px solid ${filter === key ? CRIMSON : BORDER}`, background: filter === key ? CRIMSON : "white", color: filter === key ? "white" : TEXT_DARK }}>
            {label}
          </button>
        ))}
        <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} style={{ fontFamily: FONT, fontSize: "0.8rem", padding: "0.35rem 0.5rem", borderRadius: 8, border: `1px solid ${BORDER}`, background: "white", color: TEXT_DARK }}>
          <option value={0}>Any score</option><option value={4}>Score 4+</option><option value={8}>Score 8+</option><option value={12}>Score 12+</option>
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ fontFamily: FONT, fontSize: "0.8rem", padding: "0.35rem 0.5rem", borderRadius: 8, border: `1px solid ${BORDER}`, background: "white", color: TEXT_DARK }}>
          <option value={1}>Today</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={30}>30 days</option>
        </select>
        {data && (
          <span style={{ fontSize: "0.8rem", color: TEXT_MUTED, marginLeft: "auto" }}>
            {data.total.toLocaleString()} projects · <strong style={{ color: CRIMSON }}>{data.bands.high} high priority</strong> · {data.bands.watch} watch
          </span>
        )}
      </div>

      {loading && !data ? (
        <p style={{ color: TEXT_MUTED }}>Loading…</p>
      ) : !data || data.leads.length === 0 ? (
        <p style={{ color: TEXT_MUTED }}>No projects match. Import a report or widen the filters.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.leads.map(lead => {
            const isOpen = open === lead.clusterKey;
            return (
              <div key={lead.clusterKey} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "white", overflow: "hidden" }}>
                <button onClick={() => setOpen(isOpen ? null : lead.clusterKey)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, width: "100%", textAlign: "left", padding: "0.85rem 1rem", background: "none", border: "none", cursor: "pointer", fontFamily: FONT }}>
                  <span style={{ flexShrink: 0, minWidth: 38, textAlign: "center", fontWeight: 800, fontSize: "1rem", color: "white", background: lead.topScore >= 8 ? CRIMSON : lead.topScore >= 4 ? "#b8860b" : "#9a9a9e", borderRadius: 8, padding: "0.35rem 0.4rem" }}>{lead.topScore}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: "0.95rem", color: TEXT_DARK }}>
                      {lead.projectName || lead.address || lead.clusterKey}
                      {lead.isNew && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: CRIMSON }}>NEW</span>}
                      {!lead.isNew && lead.isChanged && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: "#b8860b" }}>CHANGED</span>}
                    </span>
                    <span style={{ display: "block", fontSize: "0.8rem", color: TEXT_MUTED, marginTop: 2 }}>
                      {lead.projectName && lead.address ? `${lead.address} · ` : ""}
                      {lead.permitCount} permit{lead.permitCount === 1 ? "" : "s"} · first seen {day(lead.firstSeen)}
                      {lead.permits[0]?.valuation != null ? ` · ${money(Math.max(...lead.permits.map(p => p.valuation ?? 0)))}` : ""}
                    </span>
                    {lead.reasons.length > 0 && (
                      <span style={{ display: "block", fontSize: "0.78rem", color: TEXT_DARK, marginTop: 4 }}>
                        {lead.reasons.map(([pts, label]) => `+${pts} ${label}`).join("  ·  ")}
                      </span>
                    )}
                  </span>
                  <span style={{ color: TEXT_MUTED, fontSize: "0.8rem", flexShrink: 0 }}>{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen && (
                  <div style={{ borderTop: `1px solid ${BORDER}`, padding: "0.5rem 1rem 0.85rem" }}>
                    {lead.permits.map(p => (
                      <div key={p.permitId} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "0.45rem 0", borderBottom: `1px solid #f1efeb`, fontSize: "0.82rem" }}>
                        <span style={{ fontWeight: 700, color: TEXT_DARK, flexShrink: 0 }}>{p.permitId}</span>
                        <span style={{ flex: 1, minWidth: 0, color: TEXT_MUTED }}>
                          {p.recordType}{p.description ? ` — ${p.description.slice(0, 140)}` : ""}
                        </span>
                        <span style={{ flexShrink: 0, color: TEXT_MUTED }}>{p.status}</span>
                        {p.valuation != null && <span style={{ flexShrink: 0, color: TEXT_DARK }}>{money(p.valuation)}</span>}
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: "0.8rem" }}>
                      <a href={lead.permits.find(p => p.link)?.link || "https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?module=Building&TabName=Building"} target="_blank" rel="noopener noreferrer" style={{ color: CRIMSON, fontWeight: 700 }}>Open in Accela ↗</a>
                      {lead.address && <a href={`https://www.google.com/maps/search/${encodeURIComponent(lead.address + " Tampa FL")}`} target="_blank" rel="noopener noreferrer" style={{ color: TEXT_MUTED }}>Map ↗</a>}
                      {lead.parcel && <span style={{ color: TEXT_MUTED }}>Parcel {lead.parcel}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
