import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/adminAuth";
import {
  cached, fetchDeeds, fetchNws, geolocateDeeds, deedBadges, watchHit,
  fetchTampaMeetings, fetchBoccMeetings, discoverPlanningLayers, fetchDevCoord,
  type DeedRow, type NwsAlert, type MeetingItem, type GisLayer,
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
 .layers{position:absolute;z-index:800;top:.6rem;left:.6rem;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.35rem .6rem;display:flex;gap:.7rem;flex-wrap:wrap;font-size:.8rem;box-shadow:0 2px 10px rgba(0,0,0,.15)}
 .layers label{display:flex;align-items:center;gap:.3rem;cursor:pointer;white-space:nowrap}
 .mappane{position:relative;min-height:45vh}
 .devco .row{font-size:.85rem}
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
  const rows = (deeds.rows as DeedRow[]) ?? [];
  const alerts = (nws.items as NwsAlert[]) ?? [];
  const points = await geolocateDeeds(rows);

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
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <meta httpEquiv="refresh" content="900" />
      <header className="trib">
        <h1>tampatrib</h1>
        <span className="muted">{now} · <a href="/trib?force=1">refresh</a></span>
        <input id="q" placeholder="filter deeds… (name, street, LLC)" />
      </header>

      <div className="wrap">
        <div className="mappane">
          <div className="layers" id="layerbox">
            <strong style={{ color: "var(--muted)" }}>Layers</strong>
            {(mapData.gis.layers).map(l => (
              <label key={l.key}><input type="checkbox" data-layer={l.key} /> {
                l.key === "zoning" ? "Zoning" : l.key === "flu" ? "Future Land Use"
                : l.key === "devcoord" ? "Dev Coordination" : l.key === "cra" ? "CRAs"
                : l.key === "council" ? "Council Districts" : l.name}</label>
            ))}
          </div>
          <div id="map" />
        </div>
        <aside>
          {alerts.map((a, i) => (
            <div className="alert" key={i}><strong>{a.event}</strong>{" "}
              <span style={{ color: "#fecaca" }}>{a.headline}</span></div>
          ))}
          <h2>Meetings — Tampa City Council</h2>
          <p className="portal"><a href="https://tampagov.hylandcloud.com/221agendaonline/Meetings" target="_blank" rel="noreferrer">agenda portal ↗</a>
            <a href="https://www.tampa.gov/city-council" target="_blank" rel="noreferrer">council ↗</a></p>
          {tampaMtgs._error ? <p className="err">unavailable: {String(tampaMtgs._error)}</p> : null}
          {((tampaMtgs.items as MeetingItem[]) ?? []).map((m, i) => (
            <div className="row mtg" key={i}><span className="date">{m.date}</span>
              <a href={m.url} target="_blank" rel="noreferrer">{watchHit(m.title) ? <mark>{m.title}</mark> : m.title}</a></div>
          ))}

          <h2 style={{ marginTop: "1rem" }}>Meetings — Hillsborough BOCC</h2>
          <p className="portal"><a href="https://hcfl.gov/government/meeting-information/agendas-recaps-and-minutes" target="_blank" rel="noreferrer">agendas ↗</a>
            <a href="https://hcfl.gov/government/board-of-county-commissioners/bocc-meeting-schedule" target="_blank" rel="noreferrer">schedule ↗</a>
            <a href="https://www.hillsclerk.com/records-and-reports/bocc" target="_blank" rel="noreferrer">board records ↗</a></p>
          {boccMtgs._error ? <p className="err">unavailable: {String(boccMtgs._error)}</p> : null}
          {((boccMtgs.items as MeetingItem[]) ?? []).map((m, i) => (
            <div className="row mtg" key={i}><span className="date">{m.date}</span>
              <a href={m.url} target="_blank" rel="noreferrer">{watchHit(m.title) ? <mark>{m.title}</mark> : m.title}</a></div>
          ))}

          <h2 style={{ marginTop: "1rem" }}>Development records — City of Tampa</h2>
          <p className="portal"><a href="https://arcgis.tampagov.net/arcgis/rest/services/OpenData/Planning/MapServer" target="_blank" rel="noreferrer">source layer ↗</a>
            <a href="https://city-tampa.opendata.arcgis.com/" target="_blank" rel="noreferrer">Tampa open data ↗</a></p>
          {devco._error ? <p className="err">unavailable: {String(devco._error)}</p> : null}
          <div className="devco">
          {(((devco.items as Record<string, unknown>[]) ?? []).slice(0, 20)).map((it, i) => {
            const name = String(it.NAME ?? it.ProjectName ?? it.PROJECT ?? it.Name ?? it.TITLE ?? Object.values(it)[0] ?? "record");
            const addr = String(it.ADDRESS ?? it.Address ?? it.LOCATION ?? it.SiteAddress ?? "");
            return (
              <div className="row" key={i}>{watchHit(name + " " + addr) ? <mark>{name}</mark> : name}
                {addr ? <span className="muted"> · {addr}</span> : null}</div>
            );
          })}
          </div>

          <h2 style={{ marginTop: "1rem" }}>Deeds — last {DEED_DAYS} days, Hillsborough Clerk ({rows.length})</h2>
          {deeds._error ? <p className="err">unavailable: {String(deeds._error)}</p> : null}
          {deeds._stale ? <p className="err stale">showing cached copy (refresh failed: {String(deeds._stale)})</p> : null}
          {mapData.deeds.map(d => (
            <div className={`row deed${d.pt ? " loc" : ""}`} key={d.id || `${d.date}-${d.from}`} data-deed={d.id}>
              <span className="price">${d.price.toLocaleString("en-US")}</span>
              {d.badges.map(([label, cls]) => <span key={cls + label} className={`badge ${cls}`}>{label}</span>)}
              {d.pt && <span className="pin" title="on the map">📍</span>}
              <div><span className="muted">{d.date}</span>{" "}
                {d.from} <strong>→</strong> {d.to}
                {d.legal ? <span className="muted"> · {d.legal}</span> : null}
                <span className="muted"> · #{d.id}</span></div>
            </div>
          ))}
        </aside>
      </div>

      <footer className="trib">Deeds: Hillsborough Clerk official records, plotted by subdivision (best effort — unplotted deeds are list-only).
        {" "}Alerts: NWS, Hillsborough/Tampa. Cache {Math.round(CACHE_TTL / 60)} min; page reloads every 15.</footer>

      <div id="drawer" aria-hidden="true">
        <div className="dhead"><strong>Deed detail</strong><button className="x" id="dclose" aria-label="close">×</button></div>
        <div className="dbody" id="dbody" />
      </div>

      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" />
      <script src="https://unpkg.com/esri-leaflet@3.0.12/dist/esri-leaflet.js" />
      <script dangerouslySetInnerHTML={{ __html: `
window.__TRIB = ${JSON.stringify(mapData)};
(function boot(){
  if (!window.L) { setTimeout(boot, 60); return; }
  var map = L.map('map', { zoomSnap: .5 }).setView([27.99, -82.4], 10.5);
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
  document.getElementById('dclose').addEventListener('click', function () { drawer.classList.remove('open'); });

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
    r.classList.add('loc');
    r.addEventListener('click', function () { openDrawer(r.dataset.deed); });
  });
  Object.keys(markers).forEach(function (id) {
    markers[id].on('click', function () { openDrawer(id); });
  });
  // ---- toggleable city GIS overlays (zoning / FLU / CRA / districts) ----
  // Rendered by the city's own MapServer (its cartography), via esri-leaflet.
  var gisOverlays = {};
  function gisLayerFor(key) {
    var meta = __TRIB.gis.layers.find(function (l) { return l.key === key; });
    if (!meta || !window.L || !L.esri) return null;
    if (key === 'devcoord') {
      return L.esri.featureLayer({ url: __TRIB.gis.base + '/' + meta.id, pointToLayer: function (g, latlng) {
        return L.circleMarker(latlng, { radius: 5, color: '#7c3aed', weight: 2, fillOpacity: .5 });
      }}).bindPopup(function (l) {
        var a = l.feature && l.feature.properties || {};
        var name = a.NAME || a.ProjectName || a.PROJECT || a.Name || a.TITLE || 'record';
        var addr = a.ADDRESS || a.Address || a.LOCATION || a.SiteAddress || '';
        return '<b>' + name + '</b>' + (addr ? '<br>' + addr : '');
      });
    }
    return L.esri.dynamicMapLayer({ url: __TRIB.gis.base, layers: [meta.id], opacity: .55 });
  }
  document.querySelectorAll('#layerbox input[type=checkbox]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var key = cb.dataset.layer;
      if (cb.checked) {
        gisOverlays[key] = gisOverlays[key] || gisLayerFor(key);
        if (gisOverlays[key]) gisOverlays[key].addTo(map);
      } else if (gisOverlays[key]) {
        map.removeLayer(gisOverlays[key]);
      }
    });
  });

  document.getElementById('q').addEventListener('input', function (e) {
    var q = e.target.value.toLowerCase();
    document.querySelectorAll('.row').forEach(function (r) {
      var hide = q && !r.textContent.toLowerCase().includes(q);
      r.classList.toggle('hid', hide);
      var m = markers[r.dataset && r.dataset.deed];
      if (m) { hide ? map.removeLayer(m) : m.addTo(map); }
    });
  });
})();` }} />
    </div>
  );
}
