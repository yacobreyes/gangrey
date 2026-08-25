import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/adminAuth";
import {
  cached, fetchDeeds, fetchNws, geolocateDeeds, deedBadges,
  type DeedRow, type NwsAlert,
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
 #map{min-height:45vh;height:100%}
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
`;

export default async function TribPage({ searchParams }: { searchParams: Promise<{ force?: string }> }) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") notFound();
  const sp = await searchParams;
  const force = sp.force === "1";

  const [deeds, nws] = await Promise.all([
    cached("deeds", fetchDeeds as unknown as () => Promise<Record<string, unknown>>, force),
    cached("nws", fetchNws as unknown as () => Promise<Record<string, unknown>>, force),
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
        <div id="map" />
        <aside>
          {alerts.map((a, i) => (
            <div className="alert" key={i}><strong>{a.event}</strong>{" "}
              <span style={{ color: "#fecaca" }}>{a.headline}</span></div>
          ))}
          <h2>Deeds — last {DEED_DAYS} days, Hillsborough Clerk ({rows.length})</h2>
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

      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" />
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
  document.querySelectorAll('.row.loc').forEach(function (r) {
    r.addEventListener('click', function () {
      var m = markers[r.dataset.deed];
      if (m) { map.flyTo(m.getLatLng(), 14, { duration: .6 }); m.openPopup(); }
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
