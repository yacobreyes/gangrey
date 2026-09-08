# Tampa / Hillsborough permit data sources

Verified against live responses (fetched from a US residential connection,
pasted into the dev session) on 2026-09-10. This replaces every earlier guess:
the field names below are real.

## Network reality (governs any architecture)

- The Nuremberg VPS (Hetzner, 188.245.38.32) gets HTTP 403 from
  arcgis.tampagov.net, www.tampa.gov and www.civicdata.com (US-gov WAFs block
  non-US datacenter IPs). Confirmed by direct curl from the box.
- services.arcgis.com (Esri cloud, hosts the Hillsborough feed) — VPS
  reachability NOT YET TESTED. One curl decides whether server-side
  automation is possible from the existing box:
      curl -s -o /dev/null -w "%{http_code}\n" "https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer?f=json"
- A US residential browser reaches everything.
- Rule: no evading IP blocks (no proxies/VPNs/disguised traffic). Blocked
  hosts are collected from an allowed location (e.g. the reporter's browser)
  or not at all.

## Source 1 — City of Tampa: Planning/PermitsAll (VERIFIED)

Base: https://arcgis.tampagov.net/arcgis/rest/services/Planning/PermitsAll/FeatureServer
- One point layer: 0 "Permits". Description: "Permit data used in the
  Internal Active Permits viewer. Updated Daily." Copyright Tampa GIS.
- capabilities: Query. maxRecordCount 2000 (standard 32000 without geometry).
  Supports pagination, orderBy, statistics, geoJSON. Dates are epoch ms in
  America/New_York.
- Freshness: VERIFIED. max(LASTUPDATE) = 1788566400000 (Sept 4, 2026) when
  checked Sept 10, 2026 — actively maintained, with history back to at least
  2019 (low OBJECTIDs are old rows, so first-seen detection has a real
  baseline).

Fields (all confirmed):
| Field | Type | Notes |
| --- | --- | --- |
| OBJECTID | oid | row id, not stable across reloads — do not key on it |
| RECORD_ID | string(20) | Accela permit number, e.g. BDE-19-0439891 — THE primary key |
| PROJECTNAME1 / PROJECTNAME2 | string(200) | often blank / short label |
| PROJECTDESCRIPTION | string(300) | free text, scoring surface |
| ADDRESS / UNIT / ZIP | string | site address |
| PROJECTSTATUS | string(50) | e.g. "Issued" |
| NEWCONSTRUCTIONSF | int | square feet (no dollar valuation in this layer) |
| OCCUPANCYCATEGORY | string(100) | often blank in old rows |
| OCCUPANCYTYPE | string(100) | "Commercial" / "Residential" — cheap commercial filter |
| NBROFUNITS | int | units |
| PRIVATEPROVIDER | Yes/No | |
| STOPWORKORDER | Yes/No | newsworthy on its own |
| LASTUPDATE / CREATEDDATE | date (epoch ms ET) | change detection / filing date |
| CRA | string(50) | community redevelopment area, e.g. "East Tampa" |
| COUNCIL | string(10) | council district |
| NEIGHBORHOOD | string(100) | e.g. "North Ybor" |
| RECORDTYPE | string(100) | e.g. "Commercial Demolition Permit" |
| URL | string(500) | DIRECT Accela CapDetail link — free enrichment click-through |

Sample row (verbatim): RECORD_ID BDE-19-0439891, RECORDTYPE "Commercial
Demolition Permit", PROJECTDESCRIPTION "Demolition of one (1) story brick
building extenstion (28 x 14)", ADDRESS "2808 N 16th St", ZIP 33605,
PROJECTSTATUS Issued, OCCUPANCYTYPE Commercial, CRA "East Tampa",
NEIGHBORHOOD "North Ybor", URL https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?...

Missing from this layer: dollar valuation, contractor, applicant, owner.
Those live behind each record's Accela URL (manual click-through).

## Source 2 — Hillsborough County: AccelaDashBoard_MapService20211019 (PARTIALLY VERIFIED)

Base: https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer
- Esri cloud (not a .gov host) — the best candidate for server-side collection.
- Service description: "Accela Permits Dashboard Data Feeds Accela CO Issued
  Permits Dashboard". allowAnonymousToQuery true. hasStaticData false.
  maxRecordCount 2000. Export formats include csv/geojson.
- Layers: 0 GIS_Dashboard_Issued_CO_Merged (point — the data), 4 Issued
  (point), 3 CO / certificates of occupancy (point), 5 ZIP_USPS (polygon),
  6 Subdivisions (polygon; map dressing).
- A CO on a commercial address is a near-direct "business about to open"
  signal.
- Layer 0 field list and sample rows: NOT YET CAPTURED — fetch
  /0?f=json and /0/query?where=1%3D1&outFields=*&resultRecordCount=3&returnGeometry=false&f=json

## Source 3 — City of Tampa CKAN CSV on CivicData (fallback only)

https://www.civicdata.com/dataset/tampa_permit_standard_permits_v11_17914
BLDS-standard CSV, updated daily, resolvable via CKAN package_show. Blocked
for datacenter IPs (Cloudflare 403 from the VPS even with a browser UA).

## Source 4 — Accela Citizen Access (enrichment, manual)

Daily Permit Report generator (ASP.NET, not automated):
https://aca-prod.accela.com/TAMPA/Report/ReportParameter.aspx?module=Building&reportID=478&reportType=LINK_REPORT_LIST
Per-record detail pages: linked directly from Source 1's URL field.

## Prior art

The scrapped Lead Desk implementation (commits c620791..f8c6116, reverted in
3a8f688) contains a reusable pipeline design: verbatim raw preservation with
content-hash file dedupe, record dedupe by permit id (never report date),
first_seen_at distinct from filing date, field-change versioning with blank
protection, config-driven scoring, parcel/address clustering, ranked queue.
