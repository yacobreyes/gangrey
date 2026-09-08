"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Lead Desk — permit leads for Tampa and Hillsborough County. This panel is
// also the collector: the browser queries both public ArcGIS feeds (which
// serve residential IPs but 403 the VPS) for records changed since the last
// collection, posts them to the server pipeline, then renders the ranked
// queue of clustered projects. Schemas: docs/TAMPA_PERMIT_SOURCES.md.
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const TEXT_DARK = "#1d1d1f";
const TEXT_MUTED = "#6e6e73";
const BORDER = "#e3e1dd";
const CRIMSON = "#8f0f1b";

const FEEDS = {
  tampa: {
    label: "City of Tampa",
    layer: "https://arcgis.tampagov.net/arcgis/rest/services/Planning/PermitsAll/FeatureServer/0",
    dateField: "LASTUPDATE",
  },
  hcfl: {
    label: "Hillsborough County",
    layer: "https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer/0",
    dateField: "COMBINED_DATE",
  },
} as const;
type SourceId = keyof typeof FEEDS;

type LeadPermit = {
  uid: string; permitNo: string; source: string; recordType: string; description: string;
  status: string; valuation: number | null; stopWork: boolean; link: string;
  firstSeenAt: string; changedAt: string | null;
};
type Lead = {
  clusterKey: string; address: string; jurisdiction: string; parcel: string;
  firstSeen: string; permitCount: number; topScore: number;
  isNew: boolean; isChanged: boolean; reasons: [number, string][]; permits: LeadPermit[];
};
type QueueResponse = {
  leads: Lead[]; total: number; bands: { high: number; watch: number };
  state: Record<SourceId, { lastCollect: string | null; since: string }>;
};

const money = (n: number | null) => n == null ? "" : "$" + Math.round(n).toLocaleString("en-US");
const day = (iso: string) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

type FilterKey = "all" | "new" | "changed" | "restaurants" | "development";

export default function LeadDeskPanel() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [minScore, setMinScore] = useState(0);
  const [days, setDays] = useState(7);
  const [collecting, setCollecting] = useState(false);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const collectedOnce = useRef(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ days: String(days) });
    if (filter === "new") params.set("new", "1");
    if (filter === "changed") params.set("changed", "1");
    if (filter === "restaurants") params.set("restaurants", "1");
    if (filter === "development") params.set("development", "1");
    if (minScore > 0) params.set("minScore", String(minScore));
    try {
      const r = await fetch(`/api/admin/leads/queue?${params}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch { /* keep last good queue */ }
  }, [filter, minScore, days]);

  useEffect(() => { load(); }, [load]);

  // Pull one feed's records changed since `since` (paged), post to the server.
  async function collectFeed(id: SourceId, since: string): Promise<string> {
    const feed = FEEDS[id];
    const where = encodeURIComponent(`${feed.dateField} >= DATE '${since}'`);
    const records: Record<string, unknown>[] = [];
    for (let offset = 0, page = 0; page < 100; page++) {
      setStatus(`${feed.label}: fetching since ${since}… ${records.length.toLocaleString()} records`);
      const url = `${feed.layer}/query?where=${where}&outFields=*&returnGeometry=false&orderByFields=OBJECTID%20ASC&resultOffset=${offset}&resultRecordCount=2000&f=json`;
      const data = await (await fetch(url)).json();
      if (data.error) throw new Error(data.error.message || "feed query error");
      const feats: { attributes?: Record<string, unknown> }[] = data.features ?? [];
      for (const f of feats) if (f.attributes) records.push(f.attributes);
      if (feats.length < 2000 && !data.exceededTransferLimit) break;
      if (feats.length === 0) break;
      offset += feats.length;
      if (records.length >= 48_000) break; // stay under the server's batch cap
    }
    if (!records.length) return `${feed.label}: nothing new`;
    setStatus(`${feed.label}: importing ${records.length.toLocaleString()} records…`);
    const r = await fetch("/api/admin/leads/ingest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: id, records }),
    });
    const s = await r.json();
    if (s.error) throw new Error(s.error);
    if (s.alreadyIngested) return `${feed.label}: already imported`;
    return `${feed.label}: ${s.inserted} new, ${s.changed} changed, ${s.unchanged} unchanged`;
  }

  const collect = useCallback(async () => {
    if (collecting) return;
    setCollecting(true);
    const results: string[] = [];
    try {
      const state: Record<SourceId, { since: string }> = await (await fetch("/api/admin/leads/state", { cache: "no-store" })).json();
      for (const id of ["hcfl", "tampa"] as SourceId[]) {
        try { results.push(await collectFeed(id, state[id].since)); }
        catch (e) { results.push(`${FEEDS[id].label}: failed (${e instanceof Error ? e.message : e})`); }
      }
    } catch (e) { results.push(`Collection failed: ${String(e)}`); }
    setStatus(results.join("  ·  "));
    setCollecting(false);
    load();
  }, [collecting, load]);

  // Auto-collect when the panel opens if the last collection is stale (>6h).
  useEffect(() => {
    if (collectedOnce.current || !data) return;
    const last = [data.state?.tampa?.lastCollect, data.state?.hcfl?.lastCollect]
      .map(v => (v ? Date.parse(v) : 0)).reduce((a, b) => Math.min(a, b), Infinity);
    if (!Number.isFinite(last) || Date.now() - last > 6 * 3600 * 1000) {
      collectedOnce.current = true;
      collect();
    } else {
      collectedOnce.current = true;
    }
  }, [data, collect]);

  const chips: [FilterKey, string][] = [["all", "All"], ["new", "New"], ["changed", "Changed"], ["restaurants", "Restaurants"], ["development", "Development"]];

  return (
    <div style={{ fontFamily: FONT, maxWidth: 880 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "1rem" }}>
        <div>
          <h1 className="admin-h1">Lead Desk</h1>
          <p className="admin-sub">
            {data?.state?.hcfl?.lastCollect || data?.state?.tampa?.lastCollect
              ? `Collected: Tampa ${data.state.tampa.lastCollect ? day(data.state.tampa.lastCollect) : "never"} · County ${data.state.hcfl.lastCollect ? day(data.state.hcfl.lastCollect) : "never"}`
              : "First collection pulls the last 30 days from both public permit feeds."}
          </p>
        </div>
        <button onClick={collect} disabled={collecting}
          style={{ fontFamily: FONT, fontSize: "0.85rem", fontWeight: 700, padding: "0.55rem 1rem", borderRadius: 8, border: "none", background: CRIMSON, color: "white", cursor: collecting ? "default" : "pointer", opacity: collecting ? 0.6 : 1 }}>
          {collecting ? "Collecting…" : "Collect now"}
        </button>
      </div>

      {status && (
        <p style={{ fontSize: "0.85rem", color: TEXT_DARK, background: "#f4f2ee", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "0.6rem 0.9rem", margin: "0 0 1rem" }}>{status}</p>
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

      {!data ? (
        <p style={{ color: TEXT_MUTED }}>Loading…</p>
      ) : data.leads.length === 0 ? (
        <p style={{ color: TEXT_MUTED }}>No projects match. Collect, or widen the filters.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.leads.map(lead => {
            const isOpen = open === lead.clusterKey;
            const topVal = Math.max(0, ...lead.permits.map(p => p.valuation ?? 0));
            return (
              <div key={lead.clusterKey} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "white", overflow: "hidden" }}>
                <button onClick={() => setOpen(isOpen ? null : lead.clusterKey)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, width: "100%", textAlign: "left", padding: "0.85rem 1rem", background: "none", border: "none", cursor: "pointer", fontFamily: FONT }}>
                  <span style={{ flexShrink: 0, minWidth: 38, textAlign: "center", fontWeight: 800, fontSize: "1rem", color: "white", background: lead.topScore >= 8 ? CRIMSON : lead.topScore >= 4 ? "#b8860b" : "#9a9a9e", borderRadius: 8, padding: "0.35rem 0.4rem" }}>{lead.topScore}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: "0.95rem", color: TEXT_DARK }}>
                      {lead.address || lead.clusterKey}
                      {lead.isNew && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: CRIMSON }}>NEW</span>}
                      {!lead.isNew && lead.isChanged && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: "#b8860b" }}>CHANGED</span>}
                    </span>
                    <span style={{ display: "block", fontSize: "0.8rem", color: TEXT_MUTED, marginTop: 2 }}>
                      {lead.jurisdiction}{lead.jurisdiction ? " · " : ""}{lead.permitCount} permit{lead.permitCount === 1 ? "" : "s"} · first seen {day(lead.firstSeen)}{topVal > 0 ? ` · ${money(topVal)}` : ""}
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
                      <div key={p.uid} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "0.45rem 0", borderBottom: "1px solid #f1efeb", fontSize: "0.82rem" }}>
                        {p.link
                          ? <a href={p.link} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, color: CRIMSON, flexShrink: 0, textDecoration: "none" }}>{p.permitNo} ↗</a>
                          : <span style={{ fontWeight: 700, color: TEXT_DARK, flexShrink: 0 }}>{p.permitNo}</span>}
                        <span style={{ flex: 1, minWidth: 0, color: TEXT_MUTED }}>
                          {p.recordType}{p.description ? ` - ${p.description}` : ""}
                          {p.stopWork && <strong style={{ color: CRIMSON }}> STOP WORK</strong>}
                        </span>
                        <span style={{ flexShrink: 0, color: TEXT_MUTED }}>{p.status}</span>
                        {p.valuation != null && <span style={{ flexShrink: 0, color: TEXT_DARK }}>{money(p.valuation)}</span>}
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: "0.8rem" }}>
                      {lead.address && <a href={`https://www.google.com/maps/search/${encodeURIComponent(lead.address + " " + (lead.jurisdiction || "Tampa FL"))}`} target="_blank" rel="noopener noreferrer" style={{ color: TEXT_MUTED }}>Map ↗</a>}
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
