import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/adminAuth";
import {
  cached, fetchDeeds, fetchNws, geolocateDeeds, deedBadges, watchHit,
  fetchTampaMeetings, fetchBoccMeetings, discoverPlanningLayers, fetchDevCoord,
  fetchDistress, fetchWarn, buildLeads,
  type DeedRow, type NwsAlert, type MeetingItem, type GisLayer, type WarnRow,
} from "@/lib/trib";
import { DEED_DAYS, CACHE_TTL } from "./config";

// Private deeds map, ported from the tampatrib PHP sub-site and rebuilt
// around a Hillsborough County map: deeds plot as badge-colored dots (legal
// descriptions geocoded best-effort to their subdivision), NWS alerts draw
// their real polygons, and the full deed list rides beside the map.
//
// Gated like the DeLorean, but tighter: only a signed-in Imago ADMIN gets the
// page; everyone else gets a bare 404 with no login form, no name, nothing to
// suggest the route exists. noindex, never in the sitemap or robots.txt.
export const dynamic = "force-dynamic";

// Metadata is gated too: static metadata resolves even for a notFound()
// render and rides along in the RSC payload, so an anonymous 404 would carry
// the tool's name for anyone reading the page source.
export async function generateMetadata(): Promise<Metadata> {
  const me = await getCurrentUser();
  const admin = !!me && me.role === "admin";
  return {
    ...(admin ? { title: "tampatrib" } : {}),
    robots: { index: false, follow: false },
  };
}

const BADGE_COLOR: Record<string, string> = { big: "#065f46", ent: "#1d4ed8", nom: "#475569", flag: "#b45309", plain: "#2563eb" };

const CSS = `
 :root{--bg:#f8fafc;--fg:#0f172a;--card:#fff;--muted:#64748b;--line:#e2e8f0;--accent:#2563eb}
 @media(prefers-color-scheme:dark){:root{--bg:#0b1120;--fg:#e2e8f0;--card:#101a33;--muted:#8ea0bd;--line:#1e2b4a}}
 *{box-sizing:border-box}html,body{height:100%}
 body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;display:flex;flex-direction:column}
 header.trib{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;padding:.6rem 1rem;border-bottom:1px solid var(--line)}
 h1{font-size:1.1rem;margin:0}.muted{color:var(--muted);font-size:.85rem}
 header.trib a{color:var(--muted)}
 #q{margin-left:auto;padding:.4rem .7rem;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);min-width:240px}
 .wrap{flex:1;display:grid;grid-template-columns:1fr;min-height:0}
 @media(min-width:900px){.wrap{grid-template-columns:1.5fr 1fr}}
 #map{position:absolute;inset:0}
 @media(max-width:899px){.mappane{height:52vh}}
 aside{overflow:auto;border-left:1px solid var(--line);padding:.8rem 1rem;min-width:0}
 h2{font-size:.9rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:.2rem 0 .5rem}
 .row{padding:.5rem 0;border-top:1px solid var(--line);cursor:default}.row:first-of-type{border-top:0}
 .row.loc{cursor:pointer}.row.loc:hover{background:rgba(37,99,235,.07)}
 .deed .price{font-weight:700;min-width:6.5rem;display:inline-block}
 .badge{display:inline-block;font-size:.72rem;border-radius:4px;padding:.05rem .45rem;margin-left:.35rem;color:#fff;vertical-align:middle}
 .badge.big{background:#065f46}.badge.ent{background:#1d4ed8}.badge.nom{background:#475569}.badge.flag{background:#b45309}
 .pin{color:var(--accent);font-size:.8rem;margin-left:.3rem}
 .alert{background:#b91c1c;color:#fff;border-radius:8px;padding:.45rem .7rem;margin:.25rem 0}
 .err{color:#f87171;font-size:.85rem}.stale{color:#fbbf24}
 a{color:inherit}.hid{display:none}
 footer.trib{padding:.5rem 1rem;color:var(--muted);font-size:.78rem;border-top:1px solid var(--line)}
 .leaflet-container{background:#dbe4ec}
 .mtg .date{color:var(--muted);font-size:.82rem;min-width:5.4rem;display:inline-block}
 .portal{font-size:.82rem;color:var(--muted);margin:.2rem 0 .6rem}
 .portal a{margin-right:.8rem}
 #drawer{position:fixed;top:0;right:0;bottom:0;width:min(480px,95vw);background:var(--card);border-left:1px solid var(--line);
   box-shadow:-8px 0 30px rgba(0,0,0,.25);transform:translateX(102%);transition:transform .2s;z-index:1000;display:flex;flex-direction:column}
 #drawer.open{transform:none}
 #drawer .dhead{display:flex;align-items:center;justify-content:space-between;padding:.7rem 1rem;border-bottom:1px solid var(--line)}
 #drawer .dbody{padding:.8rem 1rem;overflow:auto}
 #drawer h3{margin:.2rem 0 .4rem;font-size:1rem}
 #drawer .links a{display:inline-block;margin:.15rem .6rem .15rem 0;color:var(--accent)}
 #drawer button.x{background:none;border:0;color:var(--muted);font-size:1.3rem;cursor:pointer}
 #drawer .party{margin:.7rem 0 .2rem;font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
 #drawer .hist .row{font-size:.85rem}
 .spin{color:var(--muted);font-size:.85rem}
 .layers{position:absolute;z-index:800;top:.6rem;right:.6rem;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.35rem .6rem;display:flex;gap:.7rem;flex-wrap:wrap;font-size:.8rem;box-shadow:0 2px 10px rgba(0,0,0,.15)}
 .layers label{display:flex;align-items:center;gap:.3rem;cursor:pointer;white-space:nowrap}
 .mappane{position:relative;min-height:45vh}
 .devco .row{font-size:.85rem}
 .tabbar{position:sticky;top:0;z-index:5;display:flex;gap:.25rem;background:var(--bg);padding:.5rem 0 .6rem;border-bottom:1px solid var(--line);margin-bottom:.4rem}
 .tb{font:inherit;font-size:.85rem;font-weight:600;padding:.35rem .8rem;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--muted);cursor:pointer}
 .tb.on{background:var(--accent);border-color:var(--accent);color:#fff}
 .panel{padding-bottom:1.5rem}
 .lead{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;background:var(--card);padding:.65rem .8rem;margin:.55rem 0}
 .lead.k-warn{border-left-color:#b91c1c}
 .lead.k-deed{border-left-color:#065f46}
 .lead.k-distress{border-left-color:#b45309}
 .lead.k-meeting{border-left-color:#7c3aed}
 .lead .lw{font-weight:700;line-height:1.35}
 .lead .lf{font-size:.88rem;margin-top:.15rem}
 .lead .lm{font-size:.72rem;color:var(--muted);margin-top:.3rem;text-transform:uppercase;letter-spacing:.05em}
 .lead.has-deed{cursor:pointer}
 .lead.has-deed:hover{border-color:var(--accent)}
 .qz{padding:1.2rem 0}
 h2.gap{margin-top:1.4rem}
 .agx{cursor:pointer}
 .agx .agt{text-decoration:underline dotted;text-underline-offset:3px}
 .agx .ext{color:var(--muted);margin-left:.4rem;text-decoration:none}
 .agitems{margin:.5rem 0 .2rem .5rem;border-left:2px solid var(--line);padding-left:.7rem}
 .agitems .ai{padding:.3rem 0;font-size:.85rem;border-top:1px dashed var(--line)}
 .agitems .ai:first-child{border-top:0}
 .agitems .ai .n{color:var(--accent);font-weight:700;margin-right:.4rem}
`;

export default async function TribPage({ searchParams }: { searchParams: Promise<{ force?: string }> }) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") notFound();
  const sp = await searchParams;
  const force = sp.force === "1";

  const [deeds, nws, tampaMtgs, boccMtgs, gis, devco] = await Promise.all([
    cached("deeds", fetchDeeds as unknown as () => Promise<Record<string, unknown>>, force),
    cached("nws", fetchNws as unknown as () => Promise<Record<string, unknown>>, force),
    cached("mtg_tampa", fetchTampaMeetings as unknown as () => Promise<Record<string, unknown>>, force),
    cached("mtg_bocc", fetchBoccMeetings as unknown as () => Promise<Record<string, unknown>>, force),
    cached("gis_layers", discoverPlanningLayers as unknown as () => Promise<Record<string, unknown>>, force),
    cached("devcoord", fetchDevCoord as unknown as () => Promise<Record<string, unknown>>, force),
  ]);
  const distress = await cached("distress", fetchDistress as unknown as () => Promise<Record<string, unknown>>, force);
  const warn = await cached("warn", fetchWarn as unknown as () => Promise<Record<string, unknown>>, force);
  const rows = (deeds.rows as DeedRow[]) ?? [];
  const alerts = (nws.items as NwsAlert[]) ?? [];
  const points = await geolocateDeeds(rows);

  const tampaItems = (tampaMtgs.items as MeetingItem[]) ?? [];
  const boccItems = (boccMtgs.items as MeetingItem[]) ?? [];
  const distressRows = (distress.rows as DeedRow[]) ?? [];
  const warnItems = (warn.items as WarnRow[]) ?? [];
  const leads = buildLeads({ deeds: rows, distress: distressRows, warn: warnItems, meetings: [...tampaItems, ...boccItems] });

  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  // Everything the map script needs, embedded once.
  const mapData = {
    deeds: rows.map(d => {
      const badges = deedBadges(d);
      return {
        id: d.instrument, price: d.price, date: d.date, from: d.from, to: d.to, legal: d.legal,
        badges, color: BADGE_COLOR[badges[0]?.[1] ?? "plain"] ?? BADGE_COLOR.plain,
        pt: points[d.instrument] ?? null,
      };
    }),
    alerts: alerts.map(a => ({ event: a.event, headline: a.headline, geometry: a.geometry ?? null })),
    gis: { base: (gis.base as string) ?? "", layers: ((gis.layers as GisLayer[]) ?? []) },
  };

  return (
    <div style={{ display: "contents" }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <link rel="stylesheet" href="/trib-vendor/leaflet.css" />
      <header className="trib">
        <h1>tampatrib</h1>
        <span className="muted">{now} · <a href="/trib?force=1">refresh</a></span>
        <input id="q" placeholder="filter deeds… (name, street, LLC)" />
      </header>

      <div className="wrap">
        <div className="mappane">
          <div className="layers" id="layerbox">
            <strong style={{ color: "var(--muted)" }}>Layers</strong>
            <span className="muted" id="layerload">loading…</span>
          </div>
          <div id="map" />
        </div>
        <aside>
          <div className="tabbar" id="tabbar">
            <button className="tb on" data-tab="leads">Leads{leads.length ? ` (${leads.length})` : ""}</button>
            <button className="tb" data-tab="records">Records</button>
            <button className="tb" data-tab="gov">Government</button>
            <button className="tb" data-tab="ev">Permits</button>
          </div>

          <div className="panel" id="panel-leads">
            {alerts.map((a, i) => (
              <div className="alert" key={i}><strong>{a.event}</strong>{" "}
                <span style={{ color: "#fecaca" }}>{a.headline}</span></div>
            ))}
            {leads.length === 0 && <p className="muted qz">Nothing scored newsworthy right now. The wires keep watching; watchlist terms live in config.</p>}
            {leads.map(l => (
              <div className={`lead k-${l.kind}${l.deedId ? " has-deed" : ""}`} key={l.id} data-deed={l.deedId ?? ""}>
                <div className="lw">{l.why}</div>
                <div className="lf">{l.what}</div>
                <div className="lm">{l.kind}{l.date ? ` · ${l.date}` : ""}{l.deedId ? " · click for the paper trail" : ""}</div>
              </div>
            ))}
          </div>

          <div className="panel hid" id="panel-records">
            <h2>Deeds — last {DEED_DAYS} days ({rows.length})</h2>
            {deeds._error ? <p className="err">unavailable: {String(deeds._error)}</p> : null}
            {deeds._stale ? <p className="err stale">showing cached copy</p> : null}
            {mapData.deeds.map(d => (
              <div className={`row deed${d.pt ? " loc" : ""}`} key={d.id || `${d.date}-${d.from}`} data-deed={d.id}>
                <span className="price">${d.price.toLocaleString("en-US")}</span>
                {d.badges.map(([label, cls]) => <span key={cls + label} className={`badge ${cls}`}>{label}</span>)}
                {d.pt && <span className="pin" title="on the map">📍</span>}
                <div><span className="muted">{d.date}</span>{" "}
                  {d.from} <strong>→</strong> {d.to}
                  {d.legal ? <span className="muted"> · {d.legal}</span> : null}</div>
              </div>
            ))}

            <h2 className="gap">Distress — lis pendens</h2>
            {distress._error ? <p className="err">unavailable: {String(distress._error)}</p> : null}
            {distressRows.slice(0, 20).map(d => (
              <div className="row" key={d.instrument}>
                <span className="muted">{d.date}</span>{" "}
                {watchHit(`${d.from} ${d.to} ${d.legal}`) ? <mark>{d.from} → {d.to}</mark> : <>{d.from} → {d.to}</>}
                {d.legal ? <span className="muted"> · {d.legal}</span> : null}
              </div>
            ))}

            <h2 className="gap">Development pipeline — City of Tampa</h2>
            <div className="devco" id="devco"><p className="spin">loading from the city&#39;s ArcGIS…</p></div>

            <h2 className="gap">Layoffs — WARN, Hillsborough</h2>
            {warn._error ? <p className="err">unavailable: {String(warn._error)}</p> : null}
            {warnItems.map((w, i) => (
              <div className="row" key={i}><strong>{w.company}</strong>
                <span className="muted"> · {w.employees ? `${w.employees} employees · ` : ""}{w.date}</span></div>
            ))}
          </div>

          <div className="panel hid" id="panel-gov">
            <h2>Tampa City Council</h2>
            <p className="portal"><a href="https://tampagov.hylandcloud.com/221agendaonline/Meetings" target="_blank" rel="noreferrer">portal ↗</a></p>
            {tampaMtgs._error ? <p className="err">unavailable: {String(tampaMtgs._error)}</p> : null}
            {tampaItems.map((m, i) => (
              <div className="row mtg agx" data-agurl={m.url} key={i}><span className="date">{m.date}</span>
                <span className="agt">{watchHit(m.title) ? <mark>{m.title}</mark> : m.title}</span>
                <a className="ext" href={m.url} target="_blank" rel="noreferrer">↗</a>
                <div className="agitems hid" /></div>
            ))}

            <h2 className="gap">Hillsborough BOCC</h2>
            <p className="portal"><a href="https://hcfl.gov/government/meeting-information/agendas-recaps-and-minutes" target="_blank" rel="noreferrer">agendas ↗</a>
              <a href="https://www.hillsclerk.com/records-and-reports/bocc" target="_blank" rel="noreferrer">board records ↗</a></p>
            {boccMtgs._error ? <p className="err">unavailable: {String(boccMtgs._error)}</p> : null}
            {boccItems.map((m, i) => (
              <div className="row mtg agx" data-agurl={m.url} key={i}><span className="date">{m.date}</span>
                <span className="agt">{watchHit(m.title) ? <mark>{m.title}</mark> : m.title}</span>
                <a className="ext" href={m.url} target="_blank" rel="noreferrer">↗</a>
                <div className="agitems hid" /></div>
            ))}

            <h2 className="gap">Campaign finance</h2>
            <p className="portal">
              <a href="https://www.votehillsborough.gov/CANDIDATES-COMMITTEES/Campaign-Finance-Reports" target="_blank" rel="noreferrer">County SOE ↗</a>
              <a href="https://dos.elections.myflorida.com/campaign-finance/contributions/" target="_blank" rel="noreferrer">State contributions ↗</a>
              <a href="https://public.ethics.state.fl.us/" target="_blank" rel="noreferrer">Disclosures ↗</a>
            </p>
          </div>

          <div className="panel hid" id="panel-ev">
            <h2>Special-event permits — City of Tampa</h2>
            <p className="portal muted">Street closures and festivals, from the city&#39;s own permit records.</p>
            <div id="sep"><p className="spin">searching the city&#39;s open data…</p></div>
          </div>
        </aside>
      </div>

      <footer className="trib">Deeds: Hillsborough Clerk official records, plotted by subdivision (best effort — unplotted deeds are list-only).
        {" "}Alerts: NWS, Hillsborough/Tampa. Cache {Math.round(CACHE_TTL / 60)} min; page reloads every 15.</footer>

      <div id="drawer" aria-hidden="true">
        <div className="dhead"><strong>Deed detail</strong><button className="x" id="dclose" aria-label="close">×</button></div>
        <div className="dbody" id="dbody" />
      </div>

      <script src="/trib-vendor/leaflet.js" />
      <script src="/trib-vendor/esri-leaflet.js" />
      <script dangerouslySetInnerHTML={{ __html: `
window.__TRIB = ${JSON.stringify(mapData)};
var map = null;
function initTrib(){
  if (!window.L) { setTimeout(initTrib, 60); return; }
  var el = document.getElementById('map');
  if (!el) { setTimeout(initTrib, 120); return; }
  // React hydration can replace the container after Leaflet booted on the old
  // node (that was the blank-map bug): if the CURRENT node isn't a leaflet
  // container, (re)initialize on it.
  if (el.classList.contains('leaflet-container')) return;
  if (map) { try { map.remove(); } catch (e) {} map = null; }
  map = L.map(el, { zoomSnap: .5 }).setView([27.99, -82.4], 10.5);
  // Esri street basemap: the ArcGIS look, no key needed.
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, attribution: 'Tiles © Esri'
  }).addTo(map);

  var markers = {};
  for (const d of __TRIB.deeds) {
    if (!d.pt) continue;
    var m = L.circleMarker(d.pt, { radius: 7, color: d.color, weight: 2, fillColor: d.color, fillOpacity: .55 }).addTo(map);
    m.bindPopup('<b>$' + d.price.toLocaleString('en-US') + '</b> · ' + d.date +
      '<br>' + d.from + ' → ' + d.to + '<br><small>' + (d.legal || '') + ' · #' + d.id + '</small>');
    markers[d.id] = m;
  }
  for (const a of __TRIB.alerts) {
    if (!a.geometry) continue;
    L.geoJSON(a.geometry, { style: { color: '#b91c1c', weight: 2, fillOpacity: .12 } })
      .bindPopup('<b>' + a.event + '</b><br>' + a.headline).addTo(map);
  }
  // ---- deed drawer: click any deed for in-site drill-down ----
  var byId = {};
  __TRIB.deeds.forEach(function (d) { byId[d.id] = d; });
  var drawer = document.getElementById('drawer');
  var dbody = document.getElementById('dbody');
  var _dc = document.getElementById('dclose');
  if (!_dc.dataset.wired) { _dc.dataset.wired = '1'; _dc.addEventListener('click', function () { drawer.classList.remove('open'); }); }

  function escHtml(x) { return String(x ?? '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function partyLinks(name) {
    var q = encodeURIComponent(name);
    var out = '<a href="https://publicaccess.hillsclerk.com/oripublicaccess/" target="_blank" rel="noreferrer">Clerk records ↗</a>' +
      '<a href="https://gis.hcpafl.org/propertysearch/#/search/basic" target="_blank" rel="noreferrer">Property Appraiser ↗</a>';
    if (/\b(LLC|L\.L\.C|CORP|INC|TRUST|LP|HOLDINGS?)\b/i.test(name))
      out += '<a href="https://search.sunbiz.org/Inquiry/CorporationSearch/ByName?searchTerm=' + q + '" target="_blank" rel="noreferrer">Sunbiz entity ↗</a>';
    return out;
  }
  function histHtml(rows) {
    if (!rows.length) return '<p class="muted">No other records found.</p>';
    return '<div class="hist">' + rows.map(function (r) {
      return '<div class="row"><span class="muted">' + escHtml(r.date) + '</span> ' +
        (r.docType ? '<strong>' + escHtml(r.docType) + '</strong> · ' : '') +
        (r.price ? '$' + Number(r.price).toLocaleString('en-US') + ' · ' : '') +
        escHtml(r.from) + ' → ' + escHtml(r.to) +
        (r.legal ? ' <span class="muted">· ' + escHtml(r.legal) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function loadParty(el, name) {
    el.innerHTML = '<p class="spin">searching Clerk records for ' + escHtml(name) + '…</p>';
    fetch('/trib/lookup?name=' + encodeURIComponent(name))
      .then(function (r) { return r.json(); })
      .then(function (j) { el.innerHTML = j.error ? '<p class="err">lookup failed: ' + escHtml(j.error) + '</p>' : histHtml(j.rows || []); })
      .catch(function () { el.innerHTML = '<p class="err">lookup failed</p>'; });
  }
  function openDrawer(id) {
    var d = byId[id];
    if (!d) return;
    var firstBuyer = (d.to || '').split(';')[0].trim();
    var firstSeller = (d.from || '').split(';')[0].trim();
    dbody.innerHTML =
      '<h3>$' + Number(d.price).toLocaleString('en-US') + ' · ' + escHtml(d.date) + '</h3>' +
      '<p>' + escHtml(d.from) + ' <strong>→</strong> ' + escHtml(d.to) + '</p>' +
      (d.legal ? '<p class="muted">' + escHtml(d.legal) + '</p>' : '') +
      '<p class="muted">Instrument #' + escHtml(d.id) + '</p>' +
      '<div class="links">' + partyLinks(d.to || '') + '</div>' +
      (firstBuyer ? '<div class="party">Buyer history — ' + escHtml(firstBuyer) + '</div><div id="hb"></div>' : '') +
      (firstSeller ? '<div class="party">Seller history — ' + escHtml(firstSeller) + '</div><div id="hs"></div>' : '');
    drawer.classList.add('open');
    if (firstBuyer) loadParty(document.getElementById('hb'), firstBuyer);
    if (firstSeller) loadParty(document.getElementById('hs'), firstSeller);
    var m = markers[id];
    if (m) { map.flyTo(m.getLatLng(), 14, { duration: .6 }); m.openPopup(); }
  }
  document.querySelectorAll('.row.deed').forEach(function (r) {
    if (r.dataset.wired) return; r.dataset.wired = '1';
    r.classList.add('loc');
    r.addEventListener('click', function () { openDrawer(r.dataset.deed); });
  });
  Object.keys(markers).forEach(function (id) {
    markers[id].on('click', function () { openDrawer(id); });
  });
  // ---- toggleable city GIS overlays (zoning / FLU / CRA / districts) ----
  // Discovery + dev-records run in the BROWSER: the city's ArcGIS serves its
  // CMS error page to datacenter IPs (the server got HTML, not JSON), while a
  // normal browser IP gets the real service. Server-side results are used
  // when present; otherwise the client fills them in.
  var GIS_BASE = 'https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Planning/MapServer';
  if (!__TRIB.gis.base) __TRIB.gis.base = GIS_BASE;
  var LAYER_WANTS = [
    ['zoning', /zoning\s*district/i], ['flu', /future\s*land\s*use/i],
    ['devcoord', /development\s*coordination/i], ['cra', /community\s*redevelopment/i],
    ['council', /council\s*district/i]
  ];
  var LAYER_LABEL = { zoning: 'Zoning', flu: 'Future Land Use', devcoord: 'Dev Coordination', cra: 'CRAs', council: 'Council Districts' };
  function buildChips() {
    var box = document.getElementById('layerbox');
    var load = document.getElementById('layerload');
    if (load) load.remove();
    __TRIB.gis.layers.forEach(function (l) {
      if (box.querySelector('[data-layer="' + l.key + '"]')) return;
      var lab = document.createElement('label');
      lab.innerHTML = '<input type="checkbox" data-layer="' + l.key + '"> ' + (LAYER_LABEL[l.key] || l.name);
      box.appendChild(lab);
      wireChip(lab.querySelector('input'));
    });
  }
  function clientDiscover() {
    if (__TRIB.gis.layers.length) { buildChips(); return; }
    fetch(GIS_BASE + '?f=pjson').then(function (r) { return r.json(); }).then(function (j) {
      (j.layers || []).forEach(function (l) {
        LAYER_WANTS.forEach(function (w) {
          if (w[1].test(String(l.name || '')) && !__TRIB.gis.layers.some(function (x) { return x.key === w[0]; }))
            __TRIB.gis.layers.push({ id: Number(l.id), name: String(l.name), key: w[0] });
        });
      });
      if (!__TRIB.gis.layers.some(function (x) { return x.key === 'devcoord'; }))
        __TRIB.gis.layers.push({ id: 31, name: 'Development Coordination Locations', key: 'devcoord' });
      buildChips();
    }).catch(function () {
      // Directory unreachable even from the browser: offer the one known layer.
      __TRIB.gis.layers.push({ id: 31, name: 'Development Coordination Locations', key: 'devcoord' });
      buildChips();
    });
  }
  function loadDevRecords() {
    var box = document.getElementById('devco');
    if (!box || box.dataset.loaded) return;
    box.dataset.loaded = '1';
    var lyr = (__TRIB.gis.layers.find(function (x) { return x.key === 'devcoord'; }) || { id: 31 });
    var base = __TRIB.gis.base + '/' + lyr.id;
    // Field aliases first, so rows read in the layer's own vocabulary instead
    // of guessed column names (the earlier version rendered bare addresses).
    Promise.all([
      fetch(base + '?f=json').then(function (r) { return r.json(); }),
      fetch(base + '/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json').then(function (r) { return r.json(); })
    ]).then(function (res) {
      var meta = res[0] || {}, j = res[1] || {};
      if (j.error) throw new Error(j.error.message || 'ArcGIS error');
      var alias = {}; (meta.fields || j.fields || []).forEach(function (f) { alias[f.name] = f.alias || f.name; });
      var feats = j.features || [];
      if (!feats.length) { box.innerHTML = '<p class="muted">No current records.</p>'; return; }
      var SKIP = /objectid|shape|globalid|guid|^fid$|_id$|latitude|longitude|^x$|^y$/i;
      function interesting(a) {
        return Object.keys(a).filter(function (k) {
          var v = a[k];
          return !SKIP.test(k) && v !== null && v !== '' && v !== 0 && String(v).length < 400;
        });
      }
      // No field-name guessing: headline each case with its first substantive
      // VALUES verbatim, expansion shows every labeled field, and the schema
      // line names what this layer actually carries.
      var schemaLine = '<p class="portal muted">fields: ' + Object.keys(alias).filter(function(k){return !SKIP.test(k);}).map(function(k){return escHtml(alias[k]||k);}).join(', ').slice(0, 300) + '</p>';
      box.innerHTML = schemaLine + feats.map(function (f, idx) {
        var a = f.attributes || {};
        var keys = interesting(a);
        var vals = keys.map(function (k) {
          var v = String(a[k]);
          if (/^\d{12,13}$/.test(v)) v = new Date(Number(v)).toISOString().slice(0,10);
          return v;
        });
        var head = vals.slice(0, 3).join(' · ');
        var detail = keys.map(function (k) {
          var v = String(a[k]);
          if (/^\d{12,13}$/.test(v)) v = new Date(Number(v)).toISOString().slice(0,10);
          return '<div><span class="muted">' + escHtml(alias[k] || k) + ':</span> ' + escHtml(v) + '</div>';
        }).join('');
        return '<div class="row devrec" data-i="' + idx + '">' +
          escHtml(head || 'no attributes on this case') +
          '<div class="agitems hid">' + detail + '</div></div>';
      }).join('');
      box.querySelectorAll('.devrec').forEach(function (r) {
        r.style.cursor = 'pointer';
        r.addEventListener('click', function () {
          r.querySelector('.agitems').classList.toggle('hid');
        });
      });
    }).catch(function (e) { box.innerHTML = '<p class="err">unavailable from this browser too: ' + escHtml(String(e.message || e)) + '</p>'; });
  }
  // ---- tabs ----
  document.querySelectorAll('#tabbar .tb').forEach(function (b) {
    if (b.dataset.wired) return; b.dataset.wired = '1';
    b.addEventListener('click', function () {
      document.querySelectorAll('#tabbar .tb').forEach(function (x) { x.classList.toggle('on', x === b); });
      ['leads','records','gov','ev'].forEach(function (t) {
        document.getElementById('panel-' + t).classList.toggle('hid', t !== b.dataset.tab);
      });
    });
  });
  document.querySelectorAll('.lead.has-deed').forEach(function (l) {
    if (l.dataset.wired) return; l.dataset.wired = '1';
    l.addEventListener('click', function () { if (l.dataset.deed) openDrawer(l.dataset.deed); });
  });

  clientDiscover();
  loadDevRecords();
  // Special-event permits: hunt the city's open-data folder for a layer whose
  // name says special event / event permit, then list the freshest rows.
  (function loadSpecialEvents() {
    var box = document.getElementById('sep');
    if (!box) return;
    var ROOT = 'https://arcgis.tampagov.net/arcgis/rest/services/OpenData';
    fetch(ROOT + '?f=pjson').then(function (r) { return r.json(); }).then(function (dir) {
      var svcs = (dir.services || []).map(function (x) { return x.name.split('/').pop(); });
      if (!svcs.length) throw new Error('no services listed');
      return Promise.all(svcs.map(function (name) {
        return fetch(ROOT + '/' + name + '/MapServer?f=pjson').then(function (r) { return r.json(); })
          .then(function (j) { return { name: name, layers: j.layers || [] }; }).catch(function () { return { name: name, layers: [] }; });
      }));
    }).then(function (all) {
      var hit = null;
      all.forEach(function (svc) {
        svc.layers.forEach(function (l) {
          if (!hit && /special\s*event|event\s*permit/i.test(String(l.name || ''))) hit = { svc: svc.name, id: l.id, name: l.name };
        });
      });
      if (!hit) { box.innerHTML = '<p class="muted">No special-events layer found in the city open data services.</p>'; return; }
      var base = ROOT + '/' + hit.svc + '/MapServer/' + hit.id;
      return Promise.all([
        fetch(base + '?f=json').then(function (r) { return r.json(); }),
        fetch(base + '/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=25&f=json').then(function (r) { return r.json(); })
      ]).then(function (res) {
        var meta = res[0] || {}, j = res[1] || {};
        var alias = {}; (meta.fields || []).forEach(function (f) { alias[f.name] = f.alias || f.name; });
        var feats = j.features || [];
        if (!feats.length) { box.innerHTML = '<p class="muted">Layer "' + escHtml(hit.name) + '" has no current rows.</p>'; return; }
        box.innerHTML = '<p class="portal muted">source: ' + escHtml(hit.svc + '/' + hit.name) + '</p>' + feats.map(function (f) {
          var a = f.attributes || {};
          var ks = Object.keys(a).filter(function (k) { return a[k] !== null && a[k] !== '' && !/objectid|shape|globalid/i.test(k); });
          var nameK = ks.find(function (k) { return /name|event|title/i.test(k); });
          var dateK = ks.find(function (k) { return /date|start/i.test(k); });
          var locK = ks.find(function (k) { return /addr|location|venue|street/i.test(k); });
          var when = dateK && /^\d{10,13}$/.test(String(a[dateK])) ? new Date(Number(a[dateK])).toISOString().slice(0,10) : (dateK ? String(a[dateK]) : '');
          return '<div class="row">' + escHtml(String(nameK ? a[nameK] : 'permit')) +
            '<span class="muted">' + (when ? ' · ' + escHtml(when) : '') + (locK ? ' · ' + escHtml(String(a[locK])) : '') + '</span></div>';
        }).join('');
      });
    }).catch(function (e) { box.innerHTML = '<p class="err">unavailable: ' + escHtml(String(e.message || e)) + '</p>'; });
  })();
  var gisOverlays = {};
  function gisLayerFor(key) {
    var meta = __TRIB.gis.layers.find(function (l) { return l.key === key; });
    if (!meta || !window.L || !L.esri) return null;
    if (key === 'devcoord') {
      return L.esri.featureLayer({ url: __TRIB.gis.base + '/' + meta.id, pointToLayer: function (g, latlng) {
        return L.circleMarker(latlng, { radius: 5, color: '#7c3aed', weight: 2, fillOpacity: .5 });
      }}).bindPopup(function (l) {
        var a = (l.feature && l.feature.properties) || {};
        var rows = Object.keys(a).filter(function (k) {
          return a[k] !== null && a[k] !== '' && !/objectid|shape|globalid/i.test(k);
        }).slice(0, 10).map(function (k) {
          var v = String(a[k]);
          if (/^\d{12,13}$/.test(v)) v = new Date(Number(v)).toISOString().slice(0,10);
          return '<b>' + k + ':</b> ' + v;
        });
        return rows.join('<br>') || 'no attributes';
      });
    }
    return L.esri.dynamicMapLayer({ url: __TRIB.gis.base, layers: [meta.id], opacity: .55 });
  }
  var WATCH = ["Ybor", "Kennedy Blvd", "Rome Ave", "Armature Works"];
  function markWatch(t) {
    var out = escHtml(t);
    WATCH.forEach(function (w) {
      var i = out.toLowerCase().indexOf(w.toLowerCase());
      if (i >= 0) out = out.slice(0, i) + '<mark>' + out.slice(i, i + w.length) + '</mark>' + out.slice(i + w.length);
    });
    return out;
  }
  function wireAgendaRows() {
    document.querySelectorAll('.row.agx').forEach(function (r) {
      if (r.dataset.agwired) return; r.dataset.agwired = '1';
      r.addEventListener('click', function (ev) {
        if (ev.target.closest('a')) return; // the ↗ still opens the source
        var box = r.querySelector('.agitems');
        if (!box.classList.contains('hid')) { box.classList.add('hid'); return; }
        box.classList.remove('hid');
        if (box.dataset.loaded) return;
        box.dataset.loaded = '1';
        box.innerHTML = '<p class="spin">loading agenda…</p>';
        fetch('/trib/agenda?url=' + encodeURIComponent(r.dataset.agurl))
          .then(function (x) { return x.json(); })
          .then(function (j) {
            if (j.error) { box.innerHTML = '<p class="err">' + escHtml(j.error) + '</p>'; return; }
            if (!j.items || !j.items.length) { box.innerHTML = '<p class="muted">' + escHtml(j.note || 'No items found.') + '</p>'; return; }
            box.innerHTML = j.items.map(function (it) {
              return '<div class="ai">' + (it.num ? '<span class="n">' + escHtml(it.num) + '</span>' : '') + markWatch(it.text) + '</div>';
            }).join('');
          })
          .catch(function () { box.innerHTML = '<p class="err">agenda fetch failed</p>'; });
      });
    });
  }
  wireAgendaRows();

  function wireChip(cb) {
    if (!cb || cb.dataset.wired) return; cb.dataset.wired = '1';
    cb.addEventListener('change', function () {
      var key = cb.dataset.layer;
      if (cb.checked) {
        gisOverlays[key] = gisOverlays[key] || gisLayerFor(key);
        if (gisOverlays[key]) gisOverlays[key].addTo(map);
      } else if (gisOverlays[key]) {
        map.removeLayer(gisOverlays[key]);
      }
    });
  }
  document.querySelectorAll('#layerbox input[type=checkbox]').forEach(wireChip);

  var _q = document.getElementById('q');
  if (!_q.dataset.wired) { _q.dataset.wired = '1';
  _q.addEventListener('input', function (e) {
    var q = e.target.value.toLowerCase();
    document.querySelectorAll('.row').forEach(function (r) {
      var hide = q && !r.textContent.toLowerCase().includes(q);
      r.classList.toggle('hid', hide);
      var m = markers[r.dataset && r.dataset.deed];
      if (m) { hide ? map.removeLayer(m) : m.addTo(map); }
    });
  }); }
}
initTrib();
// Re-check for a few seconds in case hydration swaps the node after first boot.
var _reinit = setInterval(initTrib, 400);
setTimeout(function(){ clearInterval(_reinit); }, 6000);
// Auto-reload every 15 minutes (was a meta refresh; that caused a hydration
// mismatch which is what kept replacing the map container).
setTimeout(function(){ location.reload(); }, 900000);` }} />
    </div>
  );
}
