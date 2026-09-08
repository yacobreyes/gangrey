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
  firstSeenAt: string; changedAt: string | null; whatChanged?: string;
};
type LeadContext = { owner: string; dba: string; justValue: number | null; saleAmt: number | null; saleDate: string; yearBuilt: number | null };
type Lead = {
  clusterKey: string; address: string; jurisdiction: string; parcel: string;
  firstSeen: string; permitCount: number; topScore: number;
  isNew: boolean; isChanged: boolean; completed: boolean; stale: boolean; newestSourceDate: string; latestActivity: string;
  reasons: [number, string][]; permits: LeadPermit[];
  context: LeadContext | null; contextChecked: boolean;
  coverage: null | { checked: boolean; hits: number; latest: null | { title: string; source: string; date: string; link: string } };
};
type QueueResponse = {
  leads: Lead[]; total: number; bands: { high: number; watch: number };
  state: Record<SourceId, { lastCollect: string | null; since: string }>;
};

const money = (n: number | null) => n == null ? "" : "$" + Math.round(n).toLocaleString("en-US");

// For a covered lead: what has happened on the permits SINCE the story ran.
// Not a scoop — a scoop is unreported. This is the follow-up angle, if any.
function followUpAngle(lead: Lead): string {
  const covDate = lead.coverage?.latest?.date ?? "";
  const headline = (lead.coverage?.latest?.title ?? "").toLowerCase();
  if (!covDate) return "Coverage date unknown. Compare their story against the permit timeline below.";
  const after = (d?: string | null) => !!d && d.slice(0, 10) > covDate;
  const stop = lead.permits.find(p => p.stopWork && (after(p.changedAt) || after(p.firstSeenAt)));
  if (stop) return `Stop work order landed after that story (${stop.permitNo}). Likely unreported - verify.`;
  // The CO trailing a story does not mean the opening went unreported —
  // paperwork trails reality, and a headline saying "opens" settles it.
  const co = lead.permits.find(p => p.uid.includes("|CO|") && after(p.changedAt ?? p.firstSeenAt));
  if (co && !/open|debut|launch|now serving/.test(headline)) {
    return "CO recorded after that story. If they only covered the announcement, the opening may be unreported - verify.";
  }
  if (co) return "They covered the opening. Nothing left here unless the business itself is a story.";
  const changed = lead.permits.filter(p => after(p.changedAt)).length;
  const newer = lead.permits.filter(p => after(p.firstSeenAt)).length;
  if (lead.newestSourceDate > covDate || changed || newer) {
    const parts: string[] = [];
    if (newer) parts.push(`${newer} permit${newer === 1 ? "" : "s"} filed since`);
    if (changed) parts.push(`${changed} status change${changed === 1 ? "" : "s"} since`);
    return `Coverage predates the latest permit activity (${parts.join(", ") || "newer city dates"}). The progress since ${covDate.slice(0, 10)} may be unreported - and you hold the owner and valuation.`;
  }
  return "Coverage is current. Your edge is the context on this card: owner, sale price, and the permit paper trail.";
}
const day = (iso: string) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

// The card's headline: name the thing. Brand labels from scoring are
// capitalized; the description's first segment is often the project name
// ("Dutch Bros Coffee - NEW CONSTRUCTION FOR...").
function leadTitle(lead: Lead): string {
  // The permit's own project name is what the work IS; the parcel's DBA is
  // only where it is (a hotel's DBA on a ground-floor tenant's remodel).
  const brand = lead.reasons.map(r => r[1]).find(l => /^[A-Z]/.test(l) && !/^(Ansul)/.test(l));
  if (brand) return brand;
  const desc = lead.permits.map(p => p.description).find(Boolean) ?? "";
  const first = desc.split(" - ")[0].trim();
  if (first && first.length <= 48 && !/^(new construction|demolition|interior|tenant|commercial|residential|remodel|renovation)/i.test(first)) return first;
  if (lead.context?.dba) return `Work at ${lead.context.dba}`;
  return lead.permits[0]?.recordType || "Project";
}

type Kind = "all" | "restaurants" | "development";

export default function LeadDeskPanel() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [onlyNew, setOnlyNew] = useState(true);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [onlyUncovered, setOnlyUncovered] = useState(false);
  const [minScore, setMinScore] = useState(4);
  const [days, setDays] = useState(7);
  const [sort, setSort] = useState<"date" | "score">("date");
  const [area, setArea] = useState<"" | SourceId>("");
  const [showDone, setShowDone] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Record<string, { loading?: boolean; hits?: { title: string; link: string; source: string; date: string }[]; error?: string }>>({});
  const collectedOnce = useRef(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ days: String(days) });
    if (kind === "restaurants") params.set("restaurants", "1");
    if (kind === "development") params.set("development", "1");
    if (onlyNew) params.set("new", "1");
    if (onlyChanged) params.set("changed", "1");
    if (onlyUncovered) params.set("uncovered", "1");
    if (minScore > 0) params.set("minScore", String(minScore));
    params.set("sort", sort);
    if (area) params.set("source", area);
    if (showDone) params.set("done", "1");
    try {
      const r = await fetch(`/api/admin/leads/queue?${params}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch { /* keep last good queue */ }
  }, [kind, onlyNew, onlyChanged, onlyUncovered, minScore, days, sort, area, showDone]);

  useEffect(() => { load(); }, [load]);

  // One page of an ArcGIS layer query. Throws with the layer's own error text.
  async function queryPage(layer: string, where: string, orderBy: string, offset: number) {
    const url = `${layer}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=false&orderByFields=${encodeURIComponent(orderBy)}&resultOffset=${offset}&resultRecordCount=2000&f=json`;
    const data = await (await fetch(url)).json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error.details || data.error));
    return data as { features?: { attributes?: Record<string, unknown> }[]; exceededTransferLimit?: boolean };
  }

  // Pull one feed's records changed since `since` (paged), post to the server.
  // Primary strategy: a server-side DATE filter. If the layer rejects that
  // clause, fall back to scanning newest-first without a filter and stop once
  // rows are older than `since` (client-side cutoff).
  async function collectFeed(id: SourceId, since: string): Promise<string> {
    const feed = FEEDS[id];
    const records: Record<string, unknown>[] = [];
    const sinceMs = Date.parse(since + "T00:00:00Z");
    try {
      for (let offset = 0, page = 0; page < 100; page++) {
        setStatus(`${feed.label}: fetching since ${since}… ${records.length.toLocaleString()} records`);
        const data = await queryPage(feed.layer, `${feed.dateField} >= DATE '${since}'`, "OBJECTID ASC", offset);
        const feats = data.features ?? [];
        for (const f of feats) if (f.attributes) records.push(f.attributes);
        if (feats.length < 2000 && !data.exceededTransferLimit) break;
        if (feats.length === 0) break;
        offset += feats.length;
        if (records.length >= 48_000) break; // stay under the server's batch cap
      }
    } catch (primaryErr) {
      // Fallback: newest-first scan, cut off client-side at `since`.
      setStatus(`${feed.label}: date filter rejected (${primaryErr instanceof Error ? primaryErr.message : primaryErr}); scanning newest-first…`);
      records.length = 0;
      for (let offset = 0, page = 0; page < 30; page++) {
        const data = await queryPage(feed.layer, "1=1", `${feed.dateField} DESC`, offset);
        const feats = data.features ?? [];
        let reachedOld = false;
        for (const f of feats) {
          const a = f.attributes;
          if (!a) continue;
          const ts = Number(a[feed.dateField]);
          if (Number.isFinite(ts) && ts > 1e11 && ts < sinceMs) { reachedOld = true; break; }
          records.push(a);
        }
        setStatus(`${feed.label}: scanning newest-first… ${records.length.toLocaleString()} records`);
        if (reachedOld || feats.length === 0 || records.length >= 48_000) break;
        offset += feats.length;
      }
    }
    if (!records.length) {
      // Still tell the server we checked, so "last collected" stays honest.
      await fetch("/api/admin/leads/ingest", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: id, records: [] }),
      }).catch(() => {});
      return `${feed.label}: nothing new`;
    }
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

  const collect = useCallback(async (backfillDays?: number) => {
    if (collecting) return;
    setCollecting(true);
    const results: string[] = [];
    try {
      const state: Record<SourceId, { since: string }> = await (await fetch("/api/admin/leads/state", { cache: "no-store" })).json();
      const backfillSince = backfillDays ? new Date(Date.now() - backfillDays * 86400_000).toISOString().slice(0, 10) : null;
      for (const id of ["hcfl", "tampa"] as SourceId[]) {
        try { results.push(await collectFeed(id, backfillSince ?? state[id].since)); }
        catch (e) { results.push(`${FEEDS[id].label}: failed (${e instanceof Error ? e.message : e})`); }
      }
    } catch (e) { results.push(`Collection failed: ${String(e)}`); }
    setStatus(results.join("  ·  "));
    setCollecting(false);
    load();
  }, [collecting, load]);

  // Coverage checks itself: after each queue load, quietly check leads that
  // have no stored verdict yet (a few at a time, politely paced; the server
  // caches results 24h, so this converges fast and stays cheap). Badges and
  // the Covered line appear as verdicts land; no button to remember.
  const bulkChecking = useRef(false);
  useEffect(() => {
    if (!data || bulkChecking.current || collecting) return;
    const targets = data.leads.filter(l => !l.coverage?.checked).slice(0, 12);
    if (!targets.length) return;
    bulkChecking.current = true;
    (async () => {
      for (let i = 0; i < targets.length; i++) {
        setStatus(`Checking coverage… ${i + 1}/${targets.length}`);
        await checkCoverage(targets[i]);
        await new Promise(r => setTimeout(r, 900)); // polite pacing
      }
      setStatus("");
      bulkChecking.current = false;
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, collecting]);

  // "Has this been covered?" — query news search for the lead's address and
  // strongest signals, server-side, cached 24h per cluster.
  async function checkCoverage(lead: Lead) {
    setCoverage(c => ({ ...c, [lead.clusterKey]: { loading: true } }));
    // News stories name the project ("Drury Plaza Hotel"), not the address —
    // search the name-ish tokens (brand, owner's distinctive word) plus the
    // street, with the bare address as a fallback clause.
    const brand = lead.reasons.map(r => r[1]).find(l => /^[A-Z]/.test(l) && l !== "Ansul system");
    const street = lead.address.replace(/^[0-9-]+\s*/, "").split(" ").slice(0, 3).join(" ");
    const ownerWord = (lead.context?.owner ?? "").split(/\s+/).find(w => w.length > 3 && !/^(THE|LLC|INC|CORP|CORPORATION|COMPANY|TRUST|FAMILY|GROUP|HOLDINGS|PROPERTIES|DEVELOPMENT)$/i.test(w)) ?? "";
    const nameClauses = [brand, ownerWord].filter(Boolean).map(n => `("${n}" "${street}")`);
    const query = [...nameClauses, `"${lead.address}"`].join(" OR ") + " Tampa";
    try {
      const r = await fetch("/api/admin/leads/coverage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ clusterKey: lead.clusterKey, query }),
      });
      const d = await r.json();
      if (d.error) setCoverage(c => ({ ...c, [lead.clusterKey]: { error: d.error } }));
      else setCoverage(c => ({ ...c, [lead.clusterKey]: { hits: d.hits } }));
    } catch (e) {
      setCoverage(c => ({ ...c, [lead.clusterKey]: { error: String(e) } }));
    }
  }

  // Enrich visible leads with parcel context from the Property Appraiser's
  // public HCPA_Parcels_All layer (owner, DBA, values, last sale). County
  // leads join by FOLIO (the parcel number, digits only); Tampa leads by
  // SITE_ADDR. Runs in the browser like the collectors; results are stored
  // server-side so each lead is looked up once.
  const HCPA = "https://services.arcgis.com/apTfC6SUmnNfnxuF/ArcGIS/rest/services/HCPA_Parcels_All/FeatureServer/0";
  const enriching = useRef(false);
  useEffect(() => {
    if (!data || enriching.current) return;
    const targets = data.leads.filter(l => !l.contextChecked).slice(0, 20);
    if (!targets.length) return;
    enriching.current = true;
    (async () => {
      const items: Record<string, unknown>[] = [];
      for (const lead of targets) {
        try {
          const folio = lead.parcel.replace(/\D/g, "");
          const addr = lead.address.toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim().replace(/'/g, "''");
          const where = folio.length >= 8
            ? `FOLIO='${folio}'`
            : addr ? `UPPER(SITE_ADDR) LIKE '${addr}%'` : "";
          if (!where) { items.push({ clusterKey: lead.clusterKey }); continue; }
          const url = `${HCPA}/query?where=${encodeURIComponent(where)}&outFields=FOLIO,OWNER,DBA,JUST,S_AMT,S_DATE,ACT,SITE_ADDR&returnGeometry=false&resultRecordCount=1&f=json`;
          const res = await (await fetch(url)).json();
          const a = res.features?.[0]?.attributes;
          items.push(a ? {
            clusterKey: lead.clusterKey, owner: String(a.OWNER ?? "").trim(), dba: String(a.DBA ?? "").trim(),
            folio: String(a.FOLIO ?? ""), justValue: a.JUST ?? null, saleAmt: a.S_AMT ?? null,
            saleDate: a.S_DATE ? new Date(Number(a.S_DATE)).toISOString().slice(0, 10) : "",
            yearBuilt: a.ACT ?? null, siteAddr: String(a.SITE_ADDR ?? ""),
          } : { clusterKey: lead.clusterKey }); // record "looked, not found"
        } catch { /* skip this lead; retried next open */ }
      }
      if (items.length) {
        await fetch("/api/admin/leads/context", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ items }),
        }).catch(() => {});
        load();
      }
      enriching.current = false;
    })();
  }, [data, load]);

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

  const chip = (active: boolean) => ({
    fontFamily: FONT, fontSize: "0.8rem", fontWeight: 600 as const, padding: "0.35rem 0.8rem", borderRadius: 16, cursor: "pointer",
    border: `1px solid ${active ? CRIMSON : BORDER}`, background: active ? CRIMSON : "white", color: active ? "white" : TEXT_DARK,
  });
  const dial = { fontFamily: FONT, fontSize: "0.8rem", padding: "0.35rem 0.5rem", borderRadius: 8, border: `1px solid ${BORDER}`, background: "white", color: TEXT_DARK };
  const kinds: [Kind, string][] = [["all", "Everything"], ["restaurants", "Restaurants"], ["development", "Development"]];

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
        <button onClick={() => collect()} disabled={collecting}
          style={{ fontFamily: FONT, fontSize: "0.85rem", fontWeight: 700, padding: "0.55rem 1rem", borderRadius: 8, border: "none", background: CRIMSON, color: "white", cursor: collecting ? "default" : "pointer", opacity: collecting ? 0.6 : 1 }}>
          {collecting ? "Collecting…" : "Collect now"}
        </button>
      </div>

      {status && (
        <p style={{ fontSize: "0.85rem", color: TEXT_DARK, background: "#f4f2ee", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "0.6rem 0.9rem", margin: "0 0 1rem" }}>{status}</p>
      )}

      {/* Row 1: the question. Kind is one choice; the "only" toggles stack. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {kinds.map(([key, label]) => (
          <button key={key} onClick={() => setKind(key)} style={chip(kind === key)}>{label}</button>
        ))}
        <span style={{ width: 1, height: 22, background: BORDER, margin: "0 4px" }} />
        <button onClick={() => setOnlyNew(v => !v)} style={chip(onlyNew)} title="Only projects the city dated within 90 days that are new to this desk">New</button>
        <button onClick={() => setOnlyChanged(v => !v)} style={chip(onlyChanged)} title="Only projects where a permit moved in the window (issued, CO, stop work...)">Changed</button>
        <button onClick={() => setOnlyUncovered(v => !v)} style={chip(onlyUncovered)} title="Hide anything the news search found coverage for">Uncovered</button>
        {data && (
          <span style={{ fontSize: "0.8rem", color: TEXT_MUTED, marginLeft: "auto" }}>
            {data.total.toLocaleString()} projects · <strong style={{ color: CRIMSON }}>{data.bands.high} high priority</strong> · {data.bands.watch} watch
          </span>
        )}
      </div>
      {/* Row 2: the dials. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: "1rem" }}>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={dial}>
          <option value={1}>Today</option><option value={3}>Last 3 days</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={180}>Last 6 months</option>
        </select>
        <select value={area} onChange={e => setArea(e.target.value as "" | SourceId)} style={dial}>
          <option value="">Tampa + County</option><option value="tampa">City of Tampa</option><option value="hcfl">Hillsborough County</option>
        </select>
        <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} style={dial}>
          <option value={0}>Any score</option><option value={4}>Score 4+</option><option value={8}>Score 8+</option><option value={12}>Score 12+</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as "date" | "score")} style={dial}>
          <option value="date">Latest city activity first</option><option value="score">Highest score first</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: FONT, fontSize: "0.8rem", color: TEXT_MUTED, cursor: "pointer" }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show finished
        </label>
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
                      {leadTitle(lead)}
                      <span style={{ fontWeight: 500, color: TEXT_MUTED }}> · {lead.address || lead.clusterKey}</span>
                      {lead.isNew && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: CRIMSON }}>NEW</span>}
                      {!lead.isNew && lead.isChanged && !lead.completed && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: "#b8860b" }}>CHANGED</span>}
                      {lead.completed && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: "#6e6e73" }}>DONE</span>}
                      {lead.coverage?.checked && lead.coverage.hits > 0 && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: "#b8860b" }}>COVERED</span>}
                      {lead.coverage?.checked && lead.coverage.hits === 0 && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: "#1a7f37" }}>CLEAR</span>}
                      {!lead.completed && lead.stale && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, letterSpacing: ".06em", color: "#6e6e73" }}>OLD PERMIT</span>}
                    </span>
                    <span style={{ display: "block", fontSize: "0.8rem", color: TEXT_MUTED, marginTop: 2 }}>
                      {lead.jurisdiction}{lead.jurisdiction ? " · " : ""}{lead.permitCount} permit{lead.permitCount === 1 ? "" : "s"}{lead.latestActivity ? ` · city activity ${day(lead.latestActivity)}` : ""}{lead.newestSourceDate && lead.newestSourceDate !== lead.latestActivity ? ` (filed ${day(lead.newestSourceDate)})` : ""} · collected {day(lead.firstSeen)}{topVal > 0 ? ` · ${money(topVal)}` : ""}
                    </span>
                    {lead.context && (
                      <span style={{ display: "block", fontSize: "0.78rem", color: "#3a5a40", marginTop: 4 }}>
                        {[
                          lead.context.owner ? `Owner: ${lead.context.owner}` : "",
                          lead.context.dba ? `Property: ${lead.context.dba}` : "",
                          lead.context.justValue ? `Appraised ${money(lead.context.justValue)}` : "",
                          lead.context.saleAmt ? `Last sale ${money(lead.context.saleAmt)}${lead.context.saleDate ? ` (${lead.context.saleDate.slice(0, 4)})` : ""}` : "",
                          lead.context.yearBuilt ? `Built ${lead.context.yearBuilt}` : "",
                        ].filter(Boolean).join("  ·  ")}
                      </span>
                    )}
                    {lead.coverage?.latest && lead.coverage.hits > 0 && (
                      <span style={{ display: "block", fontSize: "0.78rem", color: "#8a6d00", marginTop: 4 }}>
                        Covered: {lead.coverage.latest.source || "news"}{lead.coverage.latest.date ? ` (${lead.coverage.latest.date})` : ""} - {lead.coverage.latest.title.slice(0, 90)}
                      </span>
                    )}
                    {lead.coverage && lead.coverage.hits > 0 && (
                      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#1a5276", marginTop: 2 }}>
                        Follow-up: {followUpAngle(lead)}
                      </span>
                    )}
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
                      <div key={p.uid} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline", padding: "0.45rem 0", borderBottom: "1px solid #f1efeb", fontSize: "0.82rem" }}>
                        {p.link
                          ? <a href={p.link} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, color: CRIMSON, flexShrink: 0, textDecoration: "none" }}>{p.permitNo} ↗</a>
                          : <span style={{ fontWeight: 700, color: TEXT_DARK, flexShrink: 0 }}>{p.permitNo}</span>}
                        <span style={{ flex: 1, minWidth: 0, color: TEXT_MUTED }}>
                          {p.recordType}{p.description ? ` - ${p.description}` : ""}
                          {p.stopWork && <strong style={{ color: CRIMSON }}> STOP WORK</strong>}
                        </span>
                        <span style={{ flexShrink: 0, color: TEXT_MUTED }}>{p.status}</span>
                        {p.valuation != null && <span style={{ flexShrink: 0, color: TEXT_DARK }}>{money(p.valuation)}</span>}
                        {p.whatChanged && <span style={{ flexBasis: "100%", color: "#8a6d00", fontSize: "0.78rem", paddingTop: 2 }}>Changed: {p.whatChanged}</span>}
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
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
